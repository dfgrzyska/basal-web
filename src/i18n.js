// The page's two languages, English and Polish. The first visit follows the browser's languages (any pl-* -> Polish);
// the switch in the top bar overrides that and is remembered in this browser.
//
// Static text in index.html carries data-i18n (text), data-i18n-html (markup) or data-i18n-attr ("attr:key; ...");
// apply() fills them. Code calls t(key, vars) and redraws on the 'langchange' event.

const STORE = 'basal-web.lang';

// Polish plural forms: 1 -> one, 2-4 (not 12-14) -> few, else many
function plPlural(n, [one, few, many]) {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

const EN = {
  'nav.how': 'How it works',
  'nav.model': 'Model',
  'nav.engine': 'Engine',
  'nav.site': 'Site',
  'nav.lang': 'Page language',
  'nav.top': 'basal in your browser, top of the page',
  'hero.eyebrow': 'basal-2.0-mini · 1.5B parameters · Polish and English',
  'hero.title': 'Typed decisions, computed in this&nbsp;tab.',
  'hero.lede': 'Ask questions about a text and get answers you can act on: a choice, a yes/no probability, a score or a set of labels, each with a calibrated confidence. The model runs in your browser. Nothing you type leaves the page.',
  'load.button': 'Load the model',
  'load.size': '1.17 GB',
  'load.initial': 'Downloaded once from Hugging Face, then cached by your browser.',
  'load.cached': 'Found in your browser’s cache. Loading takes a few seconds.',
  'load.loading': 'Loading…',
  'load.downloading': 'Downloading {a} of {b} GB…',
  'load.reading': 'Reading the weights into memory…',
  'load.ready': 'Model ready',
  'load.done': '{name}, {file}. Loaded in {s} s.',
  'load.retry': 'Try again',
  'load.failed': 'The model could not be loaded: {error}',
  'load.aria': 'Model download',
  'env.device': 'Your device',
  'env.cores': ['{n} logical core', '{n} logical cores'],
  'env.threads': 'Threads',
  'env.multi': 'multi-threaded',
  'env.single': 'one (page not isolated)',
  'env.model': 'Model',
  'env.notLoaded': 'not loaded',
  'env.inCache': 'in this browser’s cache',
  'env.context': 'Context',
  'env.tokens': ['{n} token', '{n} tokens'],
  'env.checks': 'Checks',
  'env.checksOk': 'tokenizer and template match',
  'env.checksBad': 'model check failed',
  'readout.title': 'One forward pass',
  'readout.src': 'example · ticket triage',
  'readout.promptAria': 'End of the prompt the model reads',
  'readout.caption': 'The model’s next token after <code>{"answer": "</code>, counted over the option codes only. That distribution is the decision; a calibration step then sets how sure it is.',
  'try.title': 'Try it',
  'try.examples': 'Examples',
  'tab.editor': 'Request editor',
  'tab.form': 'Form',
  'tab.json': 'JSON',
  'json.aria': 'Request as JSON',
  'json.note': 'The <code>/v1/systemone</code> request of the basal engine. Tool and act questions, and every other setting, are edited here.',
  'json.error': 'This JSON can’t be read: {error}',
  'run.button': 'Decide',
  'run.needModel': 'Load the model to run your own questions.',
  'run.ready': 'Runs on this device. A question over a short text takes a few seconds.',
  'run.deciding': 'Deciding… {s} s',
  'run.done': 'Done in {s} s.',
  'run.fix': 'Fix the request and try again.',
  'run.badJson': 'The request JSON can’t be read: {error}',
  'run.reading': 'Reading prompt {i} of {n}',
  'ans.example': 'Example result',
  'ans.yours': 'Your result',
  'ans.exampleBadge': 'computed with this engine · {n} threads',
  'ans.badge': '{n} threads · {time}',
  'ans.empty': 'Load the model and press Decide to see the answers here.',
  'ans.where': 'Where the time went',
  'tile.total': 'total',
  'tile.prompts': ['prompt', 'prompts'],
  'tile.computed': 'tokens computed',
  'tile.reused': 'tokens reused',
  'legend.reused': 'reused from cache',
  'legend.computed': 'computed',
  'tip.run': '{c} tokens computed, {r} reused',
  'type.choice': 'Choice',
  'type.noul': 'Yes / no',
  'type.score': 'Score',
  'type.multi': 'Labels',
  'type.tool': 'Tool',
  'type.act': 'Action',
  'v.yes': 'Yes',
  'v.no': 'No',
  'v.scoreOf': 'of {n} · closest level: {level}',
  'v.noLabel': 'No label applies',
  'v.noTool': 'No tool',
  'v.deferred': 'Deferred',
  'v.wouldCall': 'the model would call {tool}',
  'v.outcome': 'most likely outcome: {outcome}, {p}',
  'pill.deferred': 'Deferred to a person',
  'pill.tie': 'Near tie',
  'lang.pl': 'Polish',
  'lang.en': 'English',
  'lang.promptTag': 'Prompt language',
  'chart.labels': 'P(applies) per label, asked one by one',
  'chart.selectFrom': 'select from {p}',
  'chart.outcomeYes': 'Outcome: P(yes)',
  'chart.outcome': 'Outcome',
  'chart.costs': 'Expected cost per action (lower is better)',
  'chart.certified': 'certified {p}',
  'chart.expected': 'expected {x}',
  'chart.cost': 'expected cost',
  'chart.more': 'The 12 most probable of {n} options; all are in the table.',
  'd.table': 'Table',
  'd.prompt': 'Prompt',
  'd.json': 'JSON',
  'table.option': 'Option',
  'table.label': 'Label',
  'table.model': 'model',
  'table.calibrated': 'calibrated',
  'table.note': 'Model: the softmax over the option codes. Calibrated: after temperature T = {T} ({type}, {what}).',
  'table.options': ['{n} option', '{n} options'],
  'table.labelsWhat': 'each label is a yes/no prompt; P(yes)',
  'prompt.nth': 'Prompt {i} of {n}',
  'prompt.shared': 'Highlighted: the text shared with the previous prompt, which llama.cpp reuses from its cache.',
  'fig.questions': ['{n} question', '{n} questions'],
  'fig.prompts': ['{n} prompt · {t} tokens', '{n} prompts · {t} tokens'],
  'fig.engine': '{c} computed · {r} reused',
  'fig.top': 'top {k} of {v} tokens',
  'fig.answers': '{s} s in all',
  'how.title': 'How a decision is made',
  'how.intro': 'basal is trained to answer by writing one option code. The page builds the same prompt the basal engine builds, reads that one token’s probabilities, and calibrates them. The figures below come from the last run.',
  's1.h': 'Request', 's1.p': 'A state and named questions.',
  's2.h': 'Prompt', 's2.p': 'One per question: the state, the question, the options as <code>A.</code> <code>B.</code> <code>C.</code>, ending in <code>{"answer": "</code>',
  's3.h': 'Forward pass', 's3.p': 'llama.cpp in WebAssembly reads it on your CPU. A later question reuses the state it has already read.',
  's4.h': 'Next token', 's4.p': 'The most likely next tokens, by token id.',
  's5.h': 'Codes only', 's5.p': 'A softmax over the option codes turns them into one probability per option.',
  's6.h': 'Calibration', 's6.p': 'A temperature for each question type and option count, fitted on held-out data.',
  's7.h': 'Answer', 's7.p': 'The typed answer, with a confidence you can set a threshold on.',
  'n1.h': 'Private by design', 'n1.p': 'The weights come to you, your text doesn’t go anywhere. There is no server behind this page.',
  'n2.h': 'The state is read once', 'n2.p': 'Questions over the same text share its computation, so the second and third questions cost a second or two each.',
  'n3.h': 'It knows when to pass', 'n3.p': 'Give an action question a <code>max_error</code> and it defers to a person when its calibrated confidence is below the certified threshold.',
  'footer.model': 'Model <a href="https://huggingface.co/Remek/basal-2.0-mini-GGUF">basal-2.0-mini</a> (Q5_K_M) by Remigiusz Kinas, fine-tuned from Bielik-1.5B, Apache-2.0. Prompts, readout and calibration follow the <a href="https://github.com/rkinas/basal">basal engine</a>’s prompt format 2 and are checked against basal-serve.',
  'footer.runtime': 'Runs on <a href="https://github.com/ngxson/wllama">wllama</a> (MIT). Charts by <a href="https://echarts.apache.org/">Apache ECharts</a> (Apache-2.0). Type: Schibsted Grotesk and JetBrains Mono (OFL). A small model’s decisions need checking on your own data before you rely on them.',
  'b.state': 'State',
  'b.tokens': ['≈ {n} token', '≈ {n} tokens'],
  'b.statePh': 'Paste the text the questions are about: a ticket, an email, a record',
  'b.lang': 'Prompt language',
  'b.auto': 'Auto',
  'b.langHint': 'Auto writes the prompt in Polish when the state or the question has Polish letters, as basal does.',
  'b.qName': 'Question name',
  'b.qType': 'Question type',
  'b.removeQ': 'Remove question {name}',
  'b.raw': 'This question uses settings the form doesn’t cover. Edit it in the JSON tab.',
  'b.qPh': 'Ask a question about the state',
  'b.qAria': 'Question',
  'b.key': 'key',
  'b.keyAria': 'Key of option {c}',
  'b.textAria': 'Text of option {c}',
  'b.removeOpt': 'Remove option {c}',
  'b.optPh': 'What this option says',
  'b.lowest': 'Lowest level',
  'b.next': 'Next level',
  'b.addOption': 'Add option',
  'b.addLevel': 'Add level',
  'b.addLabel': 'Add label',
  'b.scoreHint': 'Lowest level first. The answer is the expected level.',
  'b.multiHint': 'Each label is asked as its own yes/no question.',
  'b.ynHint': 'Optional: what yes and no mean here. The answer is P(yes).',
  'b.yesAria': 'Yes text',
  'b.noAria': 'No text',
  'b.showKeys': 'Show keys to the model',
  'b.threshold': 'Select labels from',
  'b.addQ': 'Add a question',
  'b.codeTitle': 'The code the model answers with',
};

const PL = {
  'nav.how': 'Jak to działa',
  'nav.model': 'Model',
  'nav.engine': 'Silnik',
  'nav.site': 'Strona',
  'nav.lang': 'Język strony',
  'nav.top': 'basal w przeglądarce, początek strony',
  'hero.eyebrow': 'basal-2.0-mini · 1,5 mld parametrów · polski i angielski',
  'hero.title': 'Decyzje liczone w&nbsp;tej&nbsp;karcie.',
  'hero.lede': 'Zadawaj pytania o tekst i dostawaj odpowiedzi, na których da się działać: wybór, prawdopodobieństwo tak/nie, ocenę albo zestaw etykiet, każdą ze skalibrowaną pewnością. Model działa w Twojej przeglądarce. Nic, co wpiszesz, nie opuszcza strony.',
  'load.button': 'Wczytaj model',
  'load.size': '1,17 GB',
  'load.initial': 'Pobierany raz z Hugging Face, potem przechowuje go przeglądarka.',
  'load.cached': 'Model jest już w przeglądarce. Wczytanie zajmie kilka sekund.',
  'load.loading': 'Wczytuję…',
  'load.downloading': 'Pobieram {a} z {b} GB…',
  'load.reading': 'Wczytuję wagi do pamięci…',
  'load.ready': 'Model gotowy',
  'load.done': '{name}, {file}. Wczytany w {s} s.',
  'load.retry': 'Spróbuj ponownie',
  'load.failed': 'Nie udało się wczytać modelu: {error}',
  'load.aria': 'Pobieranie modelu',
  'env.device': 'Twoje urządzenie',
  'env.cores': ['{n} rdzeń logiczny', '{n} rdzenie logiczne', '{n} rdzeni logicznych'],
  'env.threads': 'Wątki',
  'env.multi': 'wielowątkowo',
  'env.single': 'jeden (strona nie jest izolowana)',
  'env.model': 'Model',
  'env.notLoaded': 'niewczytany',
  'env.inCache': 'zapisany w przeglądarce',
  'env.context': 'Kontekst',
  'env.tokens': ['{n} token', '{n} tokeny', '{n} tokenów'],
  'env.checks': 'Kontrola',
  'env.checksOk': 'tokenizer i szablon się zgadzają',
  'env.checksBad': 'kontrola modelu nie przeszła',
  'readout.title': 'Jedno przejście modelu',
  'readout.src': 'przykład · zgłoszenie',
  'readout.promptAria': 'Koniec promptu, który czyta model',
  'readout.caption': 'Następny token modelu po <code>{"answer": "</code>, liczony tylko dla kodów opcji. Ten rozkład to decyzja, a kalibracja ustala, na ile jest pewna.',
  'try.title': 'Wypróbuj',
  'try.examples': 'Przykłady',
  'tab.editor': 'Edytor zapytania',
  'tab.form': 'Formularz',
  'tab.json': 'JSON',
  'json.aria': 'Zapytanie jako JSON',
  'json.note': 'Zapytanie <code>/v1/systemone</code> silnika basal. Tutaj edytujesz pytania typu tool i act oraz wszystkie inne ustawienia.',
  'json.error': 'Nie da się odczytać tego JSON-a: {error}',
  'run.button': 'Zdecyduj',
  'run.needModel': 'Wczytaj model, żeby zadać własne pytania.',
  'run.ready': 'Działa na tym urządzeniu. Pytanie o krótki tekst zajmuje kilka sekund.',
  'run.deciding': 'Decyduję… {s} s',
  'run.done': 'Gotowe w {s} s.',
  'run.fix': 'Popraw zapytanie i spróbuj ponownie.',
  'run.badJson': 'Nie da się odczytać JSON-a zapytania: {error}',
  'run.reading': 'Czytam prompt {i} z {n}',
  'ans.example': 'Przykładowy wynik',
  'ans.yours': 'Twój wynik',
  'ans.exampleBadge': 'policzony tym silnikiem · wątki: {n}',
  'ans.badge': 'wątki: {n} · {time}',
  'ans.empty': 'Wczytaj model i naciśnij „Zdecyduj”, a odpowiedzi pojawią się tutaj.',
  'ans.where': 'Na co poszedł czas',
  'tile.total': 'łącznie',
  'tile.prompts': ['prompt', 'prompty', 'promptów'],
  'tile.computed': 'policzone tokeny',
  'tile.reused': 'tokeny z pamięci',
  'legend.reused': 'z pamięci podręcznej',
  'legend.computed': 'policzone',
  'tip.run': 'policzone tokeny: {c}, z pamięci: {r}',
  'type.choice': 'Wybór',
  'type.noul': 'Tak / nie',
  'type.score': 'Ocena',
  'type.multi': 'Etykiety',
  'type.tool': 'Narzędzie',
  'type.act': 'Akcja',
  'v.yes': 'Tak',
  'v.no': 'Nie',
  'v.scoreOf': 'z {n} · najbliższy poziom: {level}',
  'v.noLabel': 'Żadna etykieta nie pasuje',
  'v.noTool': 'Bez narzędzia',
  'v.deferred': 'Odroczone',
  'v.wouldCall': 'model wywołałby {tool}',
  'v.outcome': 'najbardziej prawdopodobny wynik: {outcome}, {p}',
  'pill.deferred': 'Przekazane człowiekowi',
  'pill.tie': 'Prawie remis',
  'lang.pl': 'Polski',
  'lang.en': 'Angielski',
  'lang.promptTag': 'Język promptu',
  'chart.labels': 'P(pasuje) dla każdej etykiety, pytanej osobno',
  'chart.selectFrom': 'wybór od {p}',
  'chart.outcomeYes': 'Wynik: P(tak)',
  'chart.outcome': 'Wynik',
  'chart.costs': 'Oczekiwany koszt akcji (im mniej, tym lepiej)',
  'chart.certified': 'próg certyfikowany {p}',
  'chart.expected': 'oczekiwany {x}',
  'chart.cost': 'oczekiwany koszt',
  'chart.more': '12 najbardziej prawdopodobnych z {n} opcji; wszystkie są w tabeli.',
  'd.table': 'Tabela',
  'd.prompt': 'Prompt',
  'd.json': 'JSON',
  'table.option': 'Opcja',
  'table.label': 'Etykieta',
  'table.model': 'model',
  'table.calibrated': 'po kalibracji',
  'table.note': 'Model: softmax po kodach opcji. Po kalibracji: po temperaturze T = {T} ({type}, {what}).',
  'table.options': ['{n} opcja', '{n} opcje', '{n} opcji'],
  'table.labelsWhat': 'każda etykieta to osobny prompt tak/nie; P(tak)',
  'prompt.nth': 'Prompt {i} z {n}',
  'prompt.shared': 'Zaznaczone: tekst wspólny z poprzednim promptem, który llama.cpp bierze z pamięci podręcznej.',
  'fig.questions': ['{n} pytanie', '{n} pytania', '{n} pytań'],
  'fig.prompts': ['{n} prompt · tokeny: {t}', '{n} prompty · tokeny: {t}', '{n} promptów · tokeny: {t}'],
  'fig.engine': 'policzone: {c} · z pamięci: {r}',
  'fig.top': '{k} najlepszych z {v} tokenów',
  'fig.answers': '{s} s łącznie',
  'how.title': 'Jak powstaje decyzja',
  'how.intro': 'basal jest uczony odpowiadać jednym kodem opcji. Strona buduje ten sam prompt co silnik basal, odczytuje prawdopodobieństwa tego jednego tokenu i je kalibruje. Liczby poniżej pochodzą z ostatniego uruchomienia.',
  's1.h': 'Zapytanie', 's1.p': 'Stan i nazwane pytania.',
  's2.h': 'Prompt', 's2.p': 'Po jednym na pytanie: stan, pytanie i opcje jako <code>A.</code> <code>B.</code> <code>C.</code>, na końcu <code>{"answer": "</code>',
  's3.h': 'Przejście modelu', 's3.p': 'llama.cpp w WebAssembly czyta go na Twoim procesorze. Kolejne pytanie korzysta ze stanu, który już przeczytał.',
  's4.h': 'Następny token', 's4.p': 'Najbardziej prawdopodobne następne tokeny, rozpoznane po identyfikatorze.',
  's5.h': 'Tylko kody', 's5.p': 'Softmax po kodach opcji daje jedno prawdopodobieństwo na opcję.',
  's6.h': 'Kalibracja', 's6.p': 'Temperatura dla każdego typu pytania i liczby opcji, dopasowana na odłożonych danych.',
  's7.h': 'Odpowiedź', 's7.p': 'Odpowiedź z typem i pewnością, dla której możesz ustawić próg.',
  'n1.h': 'Prywatne z założenia', 'n1.p': 'To wagi przychodzą do Ciebie, Twój tekst nigdzie nie wychodzi. Za tą stroną nie stoi żaden serwer.',
  'n2.h': 'Stan czytany raz', 'n2.p': 'Pytania o ten sam tekst dzielą jego obliczenia, więc drugie i trzecie pytanie kosztuje sekundę lub dwie.',
  'n3.h': 'Wie, kiedy odpuścić', 'n3.p': 'Daj pytaniu o akcję <code>max_error</code>, a przekaże decyzję człowiekowi, gdy skalibrowana pewność spadnie poniżej certyfikowanego progu.',
  'footer.model': 'Model <a href="https://huggingface.co/Remek/basal-2.0-mini-GGUF">basal-2.0-mini</a> (Q5_K_M) autorstwa Remigiusza Kinasa, douczony z Bielik-1.5B, Apache-2.0. Prompty, odczyt i kalibracja są zgodne z formatem 2 <a href="https://github.com/rkinas/basal">silnika basal</a> i sprawdzone z basal-serve.',
  'footer.runtime': 'Działa na <a href="https://github.com/ngxson/wllama">wllama</a> (MIT). Wykresy: <a href="https://echarts.apache.org/">Apache ECharts</a> (Apache-2.0). Kroje: Schibsted Grotesk i JetBrains Mono (OFL). Decyzje małego modelu trzeba sprawdzić na własnych danych, zanim się na nich oprze.',
  'b.state': 'Stan',
  'b.tokens': ['≈ {n} token', '≈ {n} tokeny', '≈ {n} tokenów'],
  'b.statePh': 'Wklej tekst, którego dotyczą pytania: zgłoszenie, e-mail, rekord',
  'b.lang': 'Język promptu',
  'b.auto': 'Auto',
  'b.langHint': 'Auto pisze prompt po polsku, gdy stan lub pytanie zawiera polskie litery, tak jak basal.',
  'b.qName': 'Nazwa pytania',
  'b.qType': 'Typ pytania',
  'b.removeQ': 'Usuń pytanie {name}',
  'b.raw': 'To pytanie ma ustawienia, których formularz nie obsługuje. Edytuj je w zakładce JSON.',
  'b.qPh': 'Zadaj pytanie o stan',
  'b.qAria': 'Pytanie',
  'b.key': 'klucz',
  'b.keyAria': 'Klucz opcji {c}',
  'b.textAria': 'Treść opcji {c}',
  'b.removeOpt': 'Usuń opcję {c}',
  'b.optPh': 'Treść opcji',
  'b.lowest': 'Najniższy poziom',
  'b.next': 'Kolejny poziom',
  'b.addOption': 'Dodaj opcję',
  'b.addLevel': 'Dodaj poziom',
  'b.addLabel': 'Dodaj etykietę',
  'b.scoreHint': 'Od najniższego poziomu. Odpowiedź to oczekiwany poziom.',
  'b.multiHint': 'Każda etykieta to osobne pytanie tak/nie.',
  'b.ynHint': 'Opcjonalnie: co tu znaczy tak i nie. Odpowiedź to P(tak).',
  'b.yesAria': 'Tekst dla „tak”',
  'b.noAria': 'Tekst dla „nie”',
  'b.showKeys': 'Pokaż modelowi klucze',
  'b.threshold': 'Wybieraj etykiety od',
  'b.addQ': 'Dodaj pytanie',
  'b.codeTitle': 'Kod, którym odpowiada model',
};

export const DICTS = { en: EN, pl: PL };
export const LANGS = ['pl', 'en'];

function detect() {
  try {
    const saved = globalThis.localStorage?.getItem(STORE);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* storage blocked: follow the browser */
  }
  const prefs = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'en'];
  return prefs.some((l) => /^pl\b/i.test(l)) ? 'pl' : 'en';
}

let lang = detect();

export const getLang = () => lang;

/**
 * t('key', {n: 3}): the text in the page language. Array entries are plural forms chosen by vars.n. Numbers are
 * written in the page language's notation when the text is drawn (8,192 / 8 192, 24.5 / 24,5), so bound texts
 * follow a change of language: pass them rounded to the decimals they should show.
 */
export function t(key, vars = {}) {
  let s = DICTS[lang][key] ?? EN[key] ?? key;
  if (Array.isArray(s)) {
    const n = Number(vars.n ?? 0);
    s = lang === 'pl' ? plPlural(n, s.length === 3 ? s : [s[0], s[1], s[1]]) : n === 1 ? s[0] : s[1];
  }
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (typeof vars[k] === 'number' ? numAuto(vars[k]) : String(vars[k])) : m));
}

/** A number in the page language's notation (94.8 / 94,8; 32,000 / 32 000). */
export function num(x, digits = 0) {
  return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US',
    { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

const numAuto = (x) => new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US', { maximumFractionDigits: 2 }).format(x);

export const pct = (p) => (p > 0 && p < 0.001 ? `<${num(0.1, 1)}%` : `${num(100 * p, p >= 0.995 || p < 0.005 ? 0 : 1)}%`);

/** Fill the static text of the page (index.html) and the root's lang. */
export function apply(root = globalThis.document) {
  if (!root) return;
  root.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, vars(el));
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml, vars(el));
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key, vars(el)));
    }
  }
}

function vars(el) {
  try {
    return el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : {};
  } catch {
    return {};
  }
}

/** Show `key` (with vars) in `el` now and after every language change. html: the text is markup from the dictionary. */
export function bind(el, key, v = {}, { html = false } = {}) {
  delete el.dataset.i18n;
  delete el.dataset.i18nHtml;
  el.dataset[html ? 'i18nHtml' : 'i18n'] = key;
  el.dataset.i18nVars = JSON.stringify(v);
  if (html) el.innerHTML = t(key, v);
  else el.textContent = t(key, v);
}

export function setLang(next) {
  if (next === lang || !DICTS[next]) return;
  lang = next;
  try {
    globalThis.localStorage?.setItem(STORE, next);
  } catch {
    /* not remembered: fine */
  }
  apply();
  globalThis.dispatchEvent?.(new Event('langchange'));
}
