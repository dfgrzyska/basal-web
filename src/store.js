// The many-rows job in IndexedDB, so a reload does not lose an hour of work: the job (file rows, mapping, request)
// once, then one record per finished row. Every call tolerates a browser without storage: it then keeps nothing.

const DB = 'basal-web';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('job');
      req.result.createObjectStore('rows');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, work) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(work(t)).then((r) => (result = r));
      t.oncomplete = () => {
        db.close();
        resolve(result);
      };
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } catch {
    return undefined;
  }
}

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/** Start a new job: replaces the saved one and its rows. */
export const saveJob = (job) => tx(['job', 'rows'], 'readwrite', (t) => {
  t.objectStore('rows').clear();
  t.objectStore('job').put(job, 'current');
});

export const updateJob = (patch) => tx(['job'], 'readwrite', async (t) => {
  const s = t.objectStore('job');
  const job = await request(s.get('current'));
  if (job) s.put({ ...job, ...patch }, 'current');
});

export const saveRow = (index, result) => tx(['rows'], 'readwrite', (t) => {
  t.objectStore('rows').put(result, index);
});

/** The saved job and its finished rows (by row index), or null. */
export const loadJob = () => tx(['job', 'rows'], 'readonly', async (t) => {
  const job = await request(t.objectStore('job').get('current'));
  if (!job) return null;
  const keys = await request(t.objectStore('rows').getAllKeys());
  const values = await request(t.objectStore('rows').getAll());
  return { job, results: new Map(keys.map((k, i) => [k, values[i]])) };
});

export const clearJob = () => tx(['job', 'rows'], 'readwrite', (t) => {
  t.objectStore('job').clear();
  t.objectStore('rows').clear();
});
