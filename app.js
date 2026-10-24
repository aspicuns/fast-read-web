/**
 * fast-read Web & PWA Engine
 * Minimalist, Offline-First RSVP Speed Reading
 */

(() => {
  'use strict';

  // --- Constants & Config ---
  const APP_VERSION = 'v1.3.0';

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    wpm: 300,
    fontSize: 34,
    countdown: true,
    rewind: true,
    lastBookId: null
  };

  const WELCOME_TITLE = "fast-read'e Hoş Geldin";
  const WELCOME_TEXT = `fast-read uygulamasına hoş geldin! Bu uygulama, RSVP (Rapid Serial Visual Presentation) yöntemini kullanarak gözlerinin satırlar arasında yorulmadan, tek bir noktaya odaklanarak çok daha hızlı okumanı sağlar.

Kırmızı renkle vurgulanan harf, her kelimenin Optik Tanıma Noktası'dır (ORP). Gözlerini kelimelerin üzerinde gezdirmek yerine doğrudan üst ve alt çentiklerin arasındaki kırmızı harfe odakla. Beynin kelimeyi anında tanıyacaktır.

Kontroller çok basit:
- Ekrana dokunarak veya Boşluk tuşuna basarak okumayı başlat ve duraklat.
- Sağa veya sola kaydırarak 10 kelime ileri ya da geri sar.
- Yukarı veya aşağı kaydırarak okuma hızını (WPM) anında ayarla.
- Sol üstteki menüden dilediğin metni ekleyebilir, kütüphaneni yönetebilirsin.

Bu uygulama tamamen çevrimdışı çalışır ve internet kotanı tüketmez. İyi okumalar!`;

  // --- Grapheme & Unicode Helpers ---
  const HAS_SURROGATE_REGEX = /[\uD800-\uDFFF]/;
  let cachedSegmenter = null;

  function getGraphemes(text) {
    if (!text || typeof text !== 'string') return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      if (!cachedSegmenter) {
        cachedSegmenter = new Intl.Segmenter('tr', { granularity: 'grapheme' });
      }
      return Array.from(cachedSegmenter.segment(text), s => s.segment);
    }
    return Array.from(text);
  }

  function getWordLength(word) {
    if (!word) return 0;
    if (!HAS_SURROGATE_REGEX.test(word)) return word.length;
    return getGraphemes(word).length;
  }

  // --- ORP Calculation ---
  function getOrpIndex(word) {
    const len = getWordLength(word);
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
  }

  // Multiplier based on punctuation and word length
  function getWordMultiplier(word) {
    if (!word) return 1.0;
    if (/[.!?:]["'”»\)\]]*$/.test(word)) {
      return 2.2;
    }
    if (/[,;\-—"'”»\)\]]$/.test(word)) {
      return 1.5;
    }
    if (word.length >= 11) {
      return 1.25;
    }
    return 1.0;
  }

  // Tokenize plain text into words
  function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(word => {
        const chars = getGraphemes(word);
        const orp = getOrpIndex(word);
        const multiplier = getWordMultiplier(word);
        return {
          text: word,
          orp: Math.min(orp, Math.max(0, chars.length - 1)),
          multiplier: multiplier
        };
      });
  }

  // Time formatter
  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) {
      return `${hours} sa ${mins} dk`;
    }
    if (mins > 0) {
      return `${mins} dk`;
    }
    return `${secs} sn`;
  }

  function formatNumber(num) {
    return new Intl.NumberFormat('tr-TR').format(num);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Text Cleaner Engine ---
  const TextCleaner = {
    clean(text, options = {}) {
      if (!text || typeof text !== 'string') return '';
      const opts = {
        fixHyphenation: true,
        removeFootnotes: true,
        removePageNumbers: true,
        collapseWhitespace: true,
        ...options
      };

      let res = text;

      // Fix hyphenated words across line breaks (supports Turkish letters)
      if (opts.fixHyphenation) {
        res = res.replace(/([a-zA-ZçğıöşüÇĞİÖŞÜ])\s*[-—–]\s*[\r\n]+\s*([a-zA-ZçğıöşüÇĞİÖŞÜ])/g, '$1$2');
      }

      // Remove footnote markers attached to words or sentences: [1], [12], (1), ¹, ², ³, *
      if (opts.removeFootnotes) {
        res = res.replace(/\[\d+\]|\(\d+\)|[\*†‡§]|[\u00B9\u00B2\u00B3\u2074-\u2079]/g, '');
      }

      // Remove standalone page numbers (e.g. lines that only contain a number or '- 14 -')
      if (opts.removePageNumbers) {
        res = res.replace(/(?:^|[\r\n])\s*[-—–]?\s*\d+\s*[-—–]?\s*(?=[\r\n]|$)/g, '\n');
      }

      // Collapse multiple empty lines and excessive spaces
      if (opts.collapseWhitespace) {
        res = res.replace(/[ \t]+/g, ' ');
        res = res.replace(/\n\s*\n\s*\n+/g, '\n\n');
      }

      return res.trim();
    },

    htmlToText(html) {
      if (!html) return '';
      let str = html;
      str = str.replace(/<script[\s\S]*?<\/script>/gi, '');
      str = str.replace(/<style[\s\S]*?<\/style>/gi, '');
      str = str.replace(/<br\s*[\/]?>/gi, '\n');
      str = str.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n');
      str = str.replace(/<[^>]+>/g, '');

      const ENTITIES = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&apos;': "'",
        '&ldquo;': '“',
        '&rdquo;': '”',
        '&lsquo;': '‘',
        '&rsquo;': '’',
        '&mdash;': '—',
        '&ndash;': '–',
        '&hellip;': '…'
      };

      str = str.replace(/&(?:nbsp|amp|lt|gt|quot|#039|apos|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip);/gi, m => ENTITIES[m.toLowerCase()] || m);

      str = str.replace(/&#(\d+);/g, (_, dec) => {
        try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return ''; }
      });
      str = str.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return ''; }
      });

      return str.trim();
    }
  };

  // --- In-Browser EPUB Reader (Zero-Dependency) ---
  const EpubReader = {
    async parse(arrayBuffer) {
      const view = new DataView(arrayBuffer);
      let eocd = -1;
      for (let i = arrayBuffer.byteLength - 22; i >= Math.max(0, arrayBuffer.byteLength - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new Error('Geçersiz EPUB / ZIP dosyası');

      const totalEntries = view.getUint16(eocd + 10, true);
      const cdOffset = view.getUint32(eocd + 16, true);
      let pos = cdOffset;
      const files = {};

      for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(pos, true) !== 0x02014b50) break;
        const method = view.getUint16(pos + 10, true);
        const compSize = view.getUint32(pos + 20, true);
        const fnameLen = view.getUint16(pos + 28, true);
        const extraLen = view.getUint16(pos + 30, true);
        const commLen = view.getUint16(pos + 32, true);
        const localOffset = view.getUint32(pos + 42, true);

        const nameBytes = new Uint8Array(arrayBuffer, pos + 46, fnameLen);
        const filename = new TextDecoder('utf-8').decode(nameBytes);

        const localFnameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localFnameLen + localExtraLen;
        const compData = arrayBuffer.slice(dataStart, dataStart + compSize);

        let uncomp;
        if (method === 0) {
          uncomp = new Uint8Array(compData);
        } else if (method === 8) {
          if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(compData);
            writer.close();
            const resp = await new Response(ds.readable).arrayBuffer();
            uncomp = new Uint8Array(resp);
          } else {
            throw new Error('Tarayıcın DecompressionStream API desteklemiyor');
          }
        } else {
          uncomp = new Uint8Array(0);
        }

        files[filename] = new TextDecoder('utf-8').decode(uncomp);
        pos += 46 + fnameLen + extraLen + commLen;
      }

      // Read container.xml
      const containerXml = files['META-INF/container.xml'];
      if (!containerXml) throw new Error('container.xml bulunamadı');
      const opfPathMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
      if (!opfPathMatch) throw new Error('content.opf bulunamadı');
      const opfPath = opfPathMatch[1];
      const opfContent = files[opfPath];
      if (!opfContent) throw new Error(`${opfPath} açılamadı`);

      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

      // Title & Author
      const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
      const authorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
      const title = titleMatch ? TextCleaner.htmlToText(titleMatch[1]).trim() : 'Kitap';
      const author = authorMatch ? TextCleaner.htmlToText(authorMatch[1]).trim() : '';

      // Manifest (robust attribute order & decodeURIComponent support)
      const manifest = {};
      const itemTagRegex = /<item\b([^>]*)\/?>/gi;
      let itemTagMatch;
      while ((itemTagMatch = itemTagRegex.exec(opfContent)) !== null) {
        const attrs = itemTagMatch[1];
        const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
        const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
        if (idMatch && hrefMatch) {
          try {
            manifest[idMatch[1]] = decodeURIComponent(hrefMatch[1]);
          } catch (e) {
            manifest[idMatch[1]] = hrefMatch[1];
          }
        }
      }

      // Spine
      const spineIds = [];
      const spineRegex = /<itemref\s+[^>]*idref\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
      let m;
      while ((m = spineRegex.exec(opfContent)) !== null) {
        spineIds.push(m[1]);
      }

      const sections = [];
      for (const id of spineIds) {
        const href = manifest[id];
        if (!href) continue;
        const fullHref = (opfDir + href).replace(/^\/+/, '');
        const html = files[fullHref] || files[href] || files[decodeURIComponent(fullHref)] || files[decodeURIComponent(href)];
        if (!html) continue;

        const rawText = TextCleaner.htmlToText(html);
        if (!rawText) continue;

        let secTitle = '';
        const hMatch = html.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
        if (hMatch) {
          secTitle = TextCleaner.htmlToText(hMatch[1]).trim();
        } else {
          const classMatch = html.match(/<(?:p|div|span)[^>]*class=["'][^"']*(?:title|chapter|heading|baslik)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
          if (classMatch) {
            secTitle = TextCleaner.htmlToText(classMatch[1]).trim();
          }
        }

        // Detect generic converter names (Calibre/Sigil: index_split_000, part001, etc.)
        const isGenericName = !secTitle || /^(?:index_split_|part\d+|section\d+|page\d+|ch\d+|text\d+|titlepage|\d+$)/i.test(secTitle.trim());
        const firstLine = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)[0] || '';

        let displayTitle = '';
        if (!isGenericName) {
          displayTitle = secTitle;
        } else if (firstLine) {
          displayTitle = firstLine.length <= 50 ? firstLine : (firstLine.slice(0, 48) + '...');
        } else {
          displayTitle = href.replace(/\.[^/.]+$/, '');
        }

        const snippet = rawText.replace(/\s+/g, ' ').slice(0, 60).trim();

        const lowerHref = href.toLowerCase();
        const lowerText = rawText.slice(0, 300).toLowerCase();
        const lowerTitle = displayTitle.toLowerCase();

        let type = 'body';
        let isDefaultSelected = true;

        if (lowerHref.includes('cover') || lowerTitle.includes('kapak') || lowerText.includes('kapak')) {
          type = 'cover';
          isDefaultSelected = false;
        } else if (lowerHref.includes('copyright') || lowerTitle.includes('künye') || lowerTitle.includes('telif') || lowerText.includes('isbn') || lowerText.includes('yayınları') || lowerText.includes('telif')) {
          type = 'copyright';
          isDefaultSelected = false;
        } else if (lowerHref.includes('toc') || lowerTitle.includes('içindekiler') || lowerTitle.includes('contents')) {
          type = 'toc';
          isDefaultSelected = false;
        } else if (lowerHref.includes('preface') || lowerHref.includes('foreword') || lowerTitle.includes('önsöz') || lowerTitle.includes('sunuş') || lowerTitle.includes('çevirmen')) {
          type = 'preface';
          isDefaultSelected = false;
        } else if (lowerHref.includes('note') || lowerTitle.includes('notlar') || lowerTitle.includes('kaynakça') || lowerTitle.includes('dizin')) {
          type = 'back';
          isDefaultSelected = false;
        }

        const words = rawText.split(/\s+/).filter(w => w.length > 0);

        sections.push({
          id,
          href,
          title: displayTitle,
          snippet,
          type,
          selected: isDefaultSelected,
          text: rawText,
          wordCount: words.length
        });
      }

      return { title, author, sections };
    }
  };

  // --- Storage Manager ---
  const Storage = {
    getSettings() {
      try {
        const data = localStorage.getItem('fast_read_settings');
        if (!data) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { ...DEFAULT_SETTINGS };
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    },
    saveSettings(settings) {
      try {
        localStorage.setItem('fast_read_settings', JSON.stringify(settings));
        return true;
      } catch (e) {
        return false;
      }
    },
    getBooks() {
      try {
        const data = localStorage.getItem('fast_read_books');
        if (!data) return [];
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },
    saveBooks(books) {
      try {
        localStorage.setItem('fast_read_books', JSON.stringify(books));
        return true;
      } catch (e) {
        console.warn('[fast-read] LocalStorage saveBooks failed:', e);
        return false;
      }
    },
    getReadingList() {
      try {
        const data = localStorage.getItem('fast_read_toread');
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    },
    saveReadingList(list) {
      try {
        localStorage.setItem('fast_read_toread', JSON.stringify(list));
        return true;
      } catch (e) {
        return false;
      }
    },
    getArchive() {
      try {
        const data = localStorage.getItem('fast_read_finished');
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    },
    saveArchive(list) {
      try {
        localStorage.setItem('fast_read_finished', JSON.stringify(list));
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  // --- Main Application Controller ---
  class FastReadWeb {
    constructor() {
      this.settings = Storage.getSettings();
      this.books = Storage.getBooks();
      this.currentBook = null;
      this.tokens = [];
      this.currentIndex = 0;
      this.isPlaying = false;
      this.timerId = null;
      this.countdownValue = 0;
      this.toastTimeout = null;
      this.pendingImport = null;
      this.cachedParagraphs = [];
      this.selectedParagraphIndex = null;
      this.toreadList = Storage.getReadingList();
      this.finishedList = Storage.getArchive();
      this.currentSubTab = 'loaded';

      this.initDom();
      this.applyTheme(this.settings.theme);
      this.applyFontSize(this.settings.fontSize);
      this.initBooks();
      this.bindEvents();
      this.registerServiceWorker();
    }

    initDom() {
      this.dom = {
        app: document.getElementById('app'),
        topTitle: document.getElementById('top-book-title'),
        btnTheme: document.getElementById('btn-theme'),
        iconSun: document.getElementById('theme-icon-sun'),
        iconMoon: document.getElementById('theme-icon-moon'),
        btnFullscreen: document.getElementById('btn-fullscreen'),
        btnDrawer: document.getElementById('btn-drawer'),
        btnCloseDrawer: document.getElementById('btn-close-drawer'),
        drawer: document.getElementById('drawer'),
        drawerBackdrop: document.getElementById('drawer-backdrop'),
        tabBtns: {
          books: document.getElementById('tab-btn-books'),
          add: document.getElementById('tab-btn-add'),
          settings: document.getElementById('tab-btn-settings')
        },
        tabContents: {
          books: document.getElementById('tab-content-books'),
          add: document.getElementById('tab-content-add'),
          settings: document.getElementById('tab-content-settings')
        },
        subtabBtns: {
          loaded: document.getElementById('subtab-btn-loaded'),
          toread: document.getElementById('subtab-btn-toread'),
          finished: document.getElementById('subtab-btn-finished')
        },
        subtabContents: {
          loaded: document.getElementById('subtab-content-loaded'),
          toread: document.getElementById('subtab-content-toread'),
          finished: document.getElementById('subtab-content-finished')
        },
        toreadTitle: document.getElementById('toread-title'),
        toreadNote: document.getElementById('toread-note'),
        btnAddToread: document.getElementById('btn-add-toread'),
        toreadListContainer: document.getElementById('toread-list-container'),
        finishedTitle: document.getElementById('finished-title'),
        finishedNote: document.getElementById('finished-note'),
        btnAddFinished: document.getElementById('btn-add-finished'),
        finishedListContainer: document.getElementById('finished-list-container'),
        bookListContainer: document.getElementById('book-list-container'),
        addTitle: document.getElementById('add-title'),
        addText: document.getElementById('add-text'),
        btnClipboard: document.getElementById('btn-clipboard'),
        btnPickFile: document.getElementById('btn-pick-file'),
        filePicker: document.getElementById('file-picker'),
        btnSaveText: document.getElementById('btn-save-text'),
        settingWpm: document.getElementById('setting-wpm'),
        valWpm: document.getElementById('val-wpm'),
        settingFont: document.getElementById('setting-font'),
        valFont: document.getElementById('val-font'),
        settingCountdown: document.getElementById('setting-countdown'),
        settingRewind: document.getElementById('setting-rewind'),
        btnClearData: document.getElementById('btn-clear-data'),
        readingViewport: document.getElementById('reading-viewport'),
        wordDisplay: document.getElementById('word-display'),
        wordLeft: document.getElementById('word-left'),
        wordOrp: document.getElementById('word-orp'),
        wordRight: document.getElementById('word-right'),
        countdownDisplay: document.getElementById('countdown-display'),
        readingHint: document.getElementById('reading-hint'),
        progressBarWrap: document.getElementById('progress-bar-wrap'),
        progressFill: document.getElementById('progress-fill'),
        bottomInfoLeft: document.getElementById('bottom-info-left'),
        bottomInfoRight: document.getElementById('bottom-info-right'),
        btnWpmDown: document.getElementById('btn-wpm-down'),
        btnWpmUp: document.getElementById('btn-wpm-up'),
        btnSeekBack: document.getElementById('btn-seek-back'),
        btnSeekFwd: document.getElementById('btn-seek-fwd'),
        btnPlay: document.getElementById('btn-play'),
        iconPlay: document.getElementById('icon-play'),
        iconPause: document.getElementById('icon-pause'),
        toast: document.getElementById('toast'),
        appVersion: document.getElementById('app-version'),
        // Text / Paragraph Viewer DOM elements
        btnTextViewer: document.getElementById('btn-text-viewer'),
        textViewerModal: document.getElementById('text-viewer-modal'),
        textViewerBackdrop: document.getElementById('text-viewer-backdrop'),
        textViewerBookTitle: document.getElementById('text-viewer-book-title'),
        btnCloseTextViewer: document.getElementById('btn-close-text-viewer'),
        textViewerSearch: document.getElementById('text-viewer-search'),
        btnClearSearch: document.getElementById('btn-clear-search'),
        textViewerContent: document.getElementById('text-viewer-content'),
        textViewerActionBar: document.getElementById('text-viewer-action-bar'),
        actionParaIndicator: document.getElementById('action-para-indicator'),
        btnJumpHere: document.getElementById('btn-jump-here'),
        btnDeletePara: document.getElementById('btn-delete-para'),
        btnTrimBefore: document.getElementById('btn-trim-before'),
        // Importer DOM elements
        addFormSection: document.getElementById('add-form-section'),
        importPreviewSection: document.getElementById('import-preview-section'),
        btnCancelImport: document.getElementById('btn-cancel-import'),
        importTitleInput: document.getElementById('import-title-input'),
        importBookStats: document.getElementById('import-book-stats'),
        presetMain: document.getElementById('preset-main'),
        presetPreface: document.getElementById('preset-preface'),
        presetAll: document.getElementById('preset-all'),
        importSectionList: document.getElementById('import-section-list'),
        cleanRuleHyphen: document.getElementById('clean-rule-hyphen'),
        cleanRuleFootnotes: document.getElementById('clean-rule-footnotes'),
        cleanRulePages: document.getElementById('clean-rule-pages'),
        btnConfirmImport: document.getElementById('btn-confirm-import')
      };

      if (this.dom.appVersion) {
        this.dom.appVersion.textContent = APP_VERSION;
      }

      // Set initial control values
      this.dom.settingWpm.value = this.settings.wpm;
      this.dom.valWpm.textContent = `${this.settings.wpm} WPM`;
      this.dom.bottomInfoRight.textContent = `${this.settings.wpm} WPM`;

      this.dom.settingFont.value = this.settings.fontSize;
      this.dom.valFont.textContent = `${this.settings.fontSize} px`;

      this.dom.settingCountdown.checked = this.settings.countdown;
      this.dom.settingRewind.checked = this.settings.rewind;
    }

    initBooks() {
      if (this.books.length === 0) {
        const welcomeTokens = tokenize(WELCOME_TEXT);
        const welcomeBook = {
          id: 'welcome_' + Date.now(),
          title: WELCOME_TITLE,
          text: WELCOME_TEXT,
          wordCount: welcomeTokens.length,
          index: 0,
          finished: false,
          updatedAt: Date.now()
        };
        this.books.push(welcomeBook);
        Storage.saveBooks(this.books);
      }

      let bookToOpen = this.books.find(b => b.id === this.settings.lastBookId);
      if (!bookToOpen) {
        bookToOpen = this.books[0];
      }
      this.loadBook(bookToOpen.id);
      this.renderBookList();
      this.renderToReadList();
      this.renderFinishedList();
    }

    loadBook(bookId) {
      const book = this.books.find(b => b.id === bookId);
      if (!book) return;

      this.pause();
      this.currentBook = book;
      this.tokens = tokenize(book.text);
      this.currentIndex = Math.min(book.index || 0, Math.max(0, this.tokens.length - 1));

      this.settings.lastBookId = bookId;
      Storage.saveSettings(this.settings);

      this.dom.topTitle.textContent = book.title;
      this.updateDisplay();
      this.renderBookList();
    }

    saveCurrentBookProgress() {
      if (!this.currentBook) return;
      this.currentBook.index = this.currentIndex;
      this.currentBook.finished = (this.tokens.length > 0 && this.currentIndex >= this.tokens.length - 1);
      this.currentBook.updatedAt = Date.now();
      Storage.saveBooks(this.books);
      this.renderBookList();
    }

    // --- Reader Engine Controls ---
    play() {
      if (this.tokens.length === 0) return;
      if (this.isPlaying || this.countdownValue > 0) return;

      if (this.currentIndex >= this.tokens.length - 1) {
        this.currentIndex = 0;
      }

      if (this.settings.countdown) {
        this.startCountdown(() => {
          this.isPlaying = true;
          this.updatePlayBtnUi(true);
          this.scheduleNextWord();
        });
      } else {
        this.isPlaying = true;
        this.dom.readingHint.innerHTML = '';
        this.updatePlayBtnUi(true);
        this.scheduleNextWord();
      }
    }

    startCountdown(onComplete) {
      this.countdownValue = 3;
      this.dom.wordDisplay.style.display = 'none';
      this.dom.countdownDisplay.style.display = 'block';
      this.dom.countdownDisplay.textContent = this.countdownValue;
      this.dom.readingHint.textContent = 'Başlıyor...';

      const tick = () => {
        this.countdownValue -= 1;
        if (this.countdownValue > 0) {
          this.dom.countdownDisplay.textContent = this.countdownValue;
          this.timerId = setTimeout(tick, 300);
        } else {
          this.dom.countdownDisplay.style.display = 'none';
          this.dom.wordDisplay.style.display = 'flex';
          this.dom.readingHint.textContent = '';
          onComplete();
        }
      };

      this.timerId = setTimeout(tick, 300);
    }

    pause() {
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.countdownValue = 0;
      this.dom.countdownDisplay.style.display = 'none';
      this.dom.wordDisplay.style.display = 'flex';

      if (this.isPlaying) {
        this.isPlaying = false;
        this.updatePlayBtnUi(false);

        // Auto rewind 3 words if enabled so context is not lost
        if (this.settings.rewind && this.currentIndex > 0) {
          this.currentIndex = Math.max(0, this.currentIndex - 3);
        }
      }

      this.saveCurrentBookProgress();
      this.updateDisplay();
    }

    togglePlay() {
      if (this.isPlaying || this.countdownValue > 0) {
        this.pause();
      } else {
        this.play();
      }
    }

    scheduleNextWord() {
      if (!this.isPlaying || !this.tokens || this.tokens.length === 0) return;

      if (this.currentIndex < 0 || this.currentIndex >= this.tokens.length) {
        this.currentIndex = Math.max(0, Math.min(this.currentIndex, this.tokens.length - 1));
        this.pause();
        this.dom.readingHint.innerHTML = 'Bitti · Baştan başlamak için dokun';
        return;
      }

      const token = this.tokens[this.currentIndex];
      if (!token) {
        this.pause();
        return;
      }
      this.renderWord(token.text, token.orp);
      this.updateProgressUi();

      const baseDelay = (60 * 1000) / this.settings.wpm;
      const delay = Math.round(baseDelay * (token.multiplier || 1.0));

      this.timerId = setTimeout(() => {
        this.currentIndex += 1;
        this.scheduleNextWord();
      }, delay);
    }

    seek(delta) {
      if (this.tokens.length === 0) return;
      this.currentIndex = Math.max(0, Math.min(this.currentIndex + delta, this.tokens.length - 1));
      this.saveCurrentBookProgress();
      this.updateDisplay();
      if (!this.isPlaying) {
        this.showToast(`${delta > 0 ? '+' : ''}${delta} kelime`);
      }
    }

    seekFraction(frac) {
      if (this.tokens.length === 0) return;
      this.currentIndex = Math.max(0, Math.min(Math.floor(frac * this.tokens.length), this.tokens.length - 1));
      this.saveCurrentBookProgress();
      this.updateDisplay();
    }

    setWpm(newWpm, showNotification = true) {
      const clamped = Math.max(100, Math.min(newWpm, 1000));
      this.settings.wpm = clamped;
      Storage.saveSettings(this.settings);

      this.dom.settingWpm.value = clamped;
      this.dom.valWpm.textContent = `${clamped} WPM`;
      this.dom.bottomInfoRight.textContent = `${clamped} WPM`;
      this.updateProgressUi();

      if (showNotification) {
        this.showToast(`${clamped} WPM`);
      }
    }

    renderWord(text, orp) {
      if (!text) {
        this.dom.wordLeft.textContent = '';
        this.dom.wordOrp.textContent = '';
        this.dom.wordRight.textContent = '';
        this.dom.wordDisplay.style.transform = '';
        return;
      }

      let orpIdx = 0;
      let totalLen = 0;

      if (!HAS_SURROGATE_REGEX.test(text)) {
        totalLen = text.length;
        orpIdx = Math.max(0, Math.min(orp, totalLen - 1));
        this.dom.wordLeft.textContent = text.slice(0, orpIdx);
        this.dom.wordOrp.textContent = text[orpIdx] || '';
        this.dom.wordRight.textContent = text.slice(orpIdx + 1);
      } else {
        const chars = getGraphemes(text);
        totalLen = chars.length;
        orpIdx = Math.max(0, Math.min(orp, totalLen - 1));
        this.dom.wordLeft.textContent = chars.slice(0, orpIdx).join('');
        this.dom.wordOrp.textContent = chars[orpIdx] || '';
        this.dom.wordRight.textContent = chars.slice(orpIdx + 1).join('');
      }

      // Auto-fit long words on narrow screens so they never clip or exceed screen margins
      const maxSideChars = Math.max(orpIdx, (totalLen - 1) - orpIdx);
      if (maxSideChars > 8) {
        const scale = Math.max(0.65, 8 / maxSideChars);
        this.dom.wordDisplay.style.transform = `scale(${scale.toFixed(3)})`;
      } else {
        this.dom.wordDisplay.style.transform = 'none';
      }
    }

    getSentenceContext(curIdx) {
      if (!this.tokens || this.tokens.length === 0) return { html: '' };
      let start = curIdx;
      while (start > 0 && !/[.!?:]$/.test(this.tokens[start - 1].text) && (curIdx - start < 18)) {
        start--;
      }
      let end = curIdx;
      while (end < this.tokens.length - 1 && !/[.!?]$/.test(this.tokens[end].text) && (end - curIdx < 18)) {
        end++;
      }
      const wordsHtml = [];
      for (let i = start; i <= end; i++) {
        const t = this.tokens[i];
        if (i === curIdx) {
          wordsHtml.push(`<span class="context-cur-word">${escapeHtml(t.text)}</span>`);
        } else {
          wordsHtml.push(escapeHtml(t.text));
        }
      }
      return {
        start,
        end,
        html: (start > 0 ? '... ' : '') + wordsHtml.join(' ') + (end < this.tokens.length - 1 ? ' ...' : '')
      };
    }

    updateDisplay() {
      if (this.tokens.length === 0) {
        this.renderWord('fast', 1);
        this.dom.readingHint.innerHTML = 'Soldan metin seç veya ekle';
        this.updateProgressUi();
        return;
      }

      const token = this.tokens[this.currentIndex] || this.tokens[0];
      this.renderWord(token.text, token.orp);
      this.updateProgressUi();

      if (!this.isPlaying) {
        if (this.currentIndex >= this.tokens.length - 1) {
          this.dom.readingHint.innerHTML = 'Bitti · Baştan başlamak için dokun';
        } else {
          const ctx = this.getSentenceContext(this.currentIndex);
          this.dom.readingHint.innerHTML = `
            <div class="context-sentence" title="Paragrafları ve tam metni görmek için tıkla">
              “${ctx.html}”
            </div>
            <div class="context-action-hint">Dokunarak başlat · Paragraflar için 📖 tıkla</div>
          `;
          const ctxBtn = this.dom.readingHint.querySelector('.context-sentence');
          if (ctxBtn) {
            ctxBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.openTextViewer();
            });
          }
        }
      } else {
        this.dom.readingHint.innerHTML = '';
      }
    }

    updateProgressUi() {
      const total = this.tokens.length;
      const current = this.currentIndex;
      const pct = total > 0 ? Math.round((current / (total - 1 || 1)) * 100) : 0;

      this.dom.progressFill.style.width = `${pct}%`;

      if (total > 0) {
        const remainingWords = total - current;
        const remainingMs = (remainingWords / this.settings.wpm) * 60 * 1000;
        this.dom.bottomInfoLeft.textContent = `${formatNumber(current + 1)} / ${formatNumber(total)} kelime · %${pct} · ~${formatDuration(remainingMs)} kaldı`;
      } else {
        this.dom.bottomInfoLeft.textContent = '0 / 0 kelime · %0';
      }
    }

    updatePlayBtnUi(playing) {
      this.dom.iconPlay.style.display = playing ? 'none' : 'block';
      this.dom.iconPause.style.display = playing ? 'block' : 'none';
    }

    // --- Themes & UI Settings ---
    applyTheme(theme) {
      this.settings.theme = theme;
      document.documentElement.setAttribute('data-theme', theme);
      Storage.saveSettings(this.settings);

      const isLight = theme === 'light';
      this.dom.iconSun.style.display = isLight ? 'block' : 'none';
      this.dom.iconMoon.style.display = isLight ? 'none' : 'block';
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isLight ? '#f6f8fa' : '#141519');
      }
    }

    toggleTheme() {
      this.applyTheme(this.settings.theme === 'dark' ? 'light' : 'dark');
    }

    applyFontSize(px) {
      this.settings.fontSize = px;
      document.documentElement.style.setProperty('--word-size', `${px}px`);
      this.dom.settingFont.value = px;
      this.dom.valFont.textContent = `${px} px`;
      Storage.saveSettings(this.settings);
    }

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }

    showToast(message) {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.dom.toast.textContent = message;
      this.dom.toast.classList.add('show');
      this.toastTimeout = setTimeout(() => {
        this.dom.toast.classList.remove('show');
      }, 1500);
    }

    // --- Drawer & Books Rendering ---
    toggleDrawer(open) {
      const isOpen = open !== undefined ? open : !this.dom.drawer.classList.contains('open');
      this.dom.drawer.classList.toggle('open', isOpen);
      this.dom.drawerBackdrop.classList.toggle('open', isOpen);
      if (isOpen && this.isPlaying) {
        this.pause();
      }
    }

    switchTab(tabKey) {
      Object.keys(this.dom.tabBtns).forEach(k => {
        const isActive = k === tabKey;
        this.dom.tabBtns[k].classList.toggle('active', isActive);
        this.dom.tabContents[k].style.display = isActive ? 'flex' : 'none';
      });
    }

    renderBookList() {
      const container = this.dom.bookListContainer;
      container.innerHTML = '';

      if (this.books.length === 0) {
        container.innerHTML = '<div style="font-size: 13px; color: var(--muted); padding: 12px 0;">Henüz metin yok. Metin Ekle sekmesinden yeni metin ekleyebilirsin.</div>';
        return;
      }

      this.books.forEach(book => {
        const item = document.createElement('div');
        item.className = 'book-item' + (this.currentBook && this.currentBook.id === book.id ? ' active' : '');

        const pct = book.wordCount > 0 ? Math.round((book.index / (book.wordCount - 1 || 1)) * 100) : 0;
        const safeTitle = escapeHtml(book.title);

        item.innerHTML = `
          <div class="book-item-header">
            <div class="book-item-title" title="${safeTitle}">${safeTitle}</div>
            <div class="book-item-actions">
              <button class="btn-mini btn-finish" title="Okuduklarım Arşivine Ekle">✓</button>
              <button class="btn-mini btn-rename" title="Yeniden Adlandır">✎</button>
              <button class="btn-mini btn-delete" title="Sil">×</button>
            </div>
          </div>
          <div class="book-item-meta">
            <span>${formatNumber(book.wordCount)} kelime</span>
            <span>%${pct}</span>
          </div>
          <div class="book-item-progress-track">
            <div class="book-item-progress-fill" style="width: ${pct}%"></div>
          </div>
        `;

        // Click to open
        item.addEventListener('click', (e) => {
          if (e.target.closest('.book-item-actions')) return;
          this.loadBook(book.id);
          this.toggleDrawer(false);
        });

        // Finish / Archive button
        const btnFinish = item.querySelector('.btn-finish');
        btnFinish.addEventListener('click', (e) => {
          e.stopPropagation();
          this.archiveLoadedBook(book.id);
        });

        // Rename button
        const btnRename = item.querySelector('.btn-rename');
        btnRename.addEventListener('click', (e) => {
          e.stopPropagation();
          const newTitle = prompt('Yeni kitap başlığı:', book.title);
          if (newTitle && newTitle.trim()) {
            book.title = newTitle.trim();
            Storage.saveBooks(this.books);
            if (this.currentBook && this.currentBook.id === book.id) {
              this.dom.topTitle.textContent = book.title;
            }
            this.renderBookList();
          }
        });

        // Delete button
        const btnDelete = item.querySelector('.btn-delete');
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`"${book.title}" silinsin mi?`)) {
            this.books = this.books.filter(b => b.id !== book.id);
            Storage.saveBooks(this.books);
            if (this.currentBook && this.currentBook.id === book.id) {
              this.currentBook = null;
              this.tokens = [];
              this.currentIndex = 0;
              this.initBooks();
            } else {
              this.renderBookList();
            }
          }
        });

        container.appendChild(item);
      });
    }

    // --- Kitaplarım Sub-Tabs & Reading Journal (Okuyacaklarım & Okuduklarım) ---
    switchSubTab(subTabKey) {
      this.currentSubTab = subTabKey;
      Object.keys(this.dom.subtabBtns).forEach(k => {
        const isActive = (k === subTabKey);
        this.dom.subtabBtns[k].classList.toggle('active', isActive);
        this.dom.subtabContents[k].style.display = isActive ? 'flex' : 'none';
      });

      if (subTabKey === 'loaded') {
        this.renderBookList();
      } else if (subTabKey === 'toread') {
        this.renderToReadList();
      } else if (subTabKey === 'finished') {
        this.renderFinishedList();
      }
    }

    archiveLoadedBook(bookId) {
      const book = this.books.find(b => b.id === bookId);
      if (!book) return;

      const defaultDate = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      const userNote = prompt(`"${book.title}" Okuduklarım listesine eklensin.\nİsteğe bağlı bir not veya bitirme tarihi yazabilirsin:`, `${defaultDate} tarihinde bitirildi.`);
      if (userNote === null) return;

      const newFinished = {
        id: 'fn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: book.title,
        note: userNote.trim(),
        createdAt: Date.now()
      };

      this.finishedList.unshift(newFinished);
      Storage.saveArchive(this.finishedList);
      this.renderFinishedList();

      const wantDelete = confirm(`"${book.title}" Okuduklarım arşivine eklendi!\n\nHafızada yer açmak için bu kitabın metni Kütüphane'den silinsin mi?\n(Tamam = Metni sil ve yer aç, İptal = Metni tut)`);
      if (wantDelete) {
        this.books = this.books.filter(b => b.id !== book.id);
        Storage.saveBooks(this.books);
        if (this.currentBook && this.currentBook.id === book.id) {
          this.currentBook = null;
          this.tokens = [];
          this.currentIndex = 0;
          this.initBooks();
        } else {
          this.renderBookList();
        }
        this.showToast('Okuduklarıma eklendi, metin hafızadan temizlendi.');
      } else {
        this.showToast('Okuduklarım arşivine kaydedildi!');
      }
    }

    renderToReadList() {
      const container = this.dom.toreadListContainer;
      container.innerHTML = '';

      if (this.toreadList.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--muted); text-align: center; padding: 18px 0;">Henüz okuma listende kitap yok.<br>Yukarıdaki alandan yeni kitap ve not ekleyebilirsin.</div>';
        return;
      }

      this.toreadList.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'journal-card';
        const dateStr = new Date(item.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

        card.innerHTML = `
          <div class="journal-card-header">
            <div class="journal-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            <div class="journal-card-actions">
              <button class="btn-mini btn-finish" title="Okundu Olarak İşaretle (Okuduklarıma Taşı)">✓</button>
              <button class="btn-mini btn-rename" title="Düzenle">✎</button>
              <button class="btn-mini btn-delete" title="Sil">×</button>
            </div>
          </div>
          ${item.note ? `<div class="journal-card-note">${escapeHtml(item.note)}</div>` : ''}
          <div class="journal-card-date">Eklendi: ${dateStr}</div>
        `;

        card.querySelector('.btn-finish').addEventListener('click', () => {
          this.promoteToReadToFinished(item.id);
        });

        card.querySelector('.btn-rename').addEventListener('click', () => {
          this.editToReadItem(item.id);
        });

        card.querySelector('.btn-delete').addEventListener('click', () => {
          if (confirm(`"${item.title}" okuma listenden silinsin mi?`)) {
            this.toreadList = this.toreadList.filter(t => t.id !== item.id);
            Storage.saveReadingList(this.toreadList);
            this.renderToReadList();
            this.showToast('Listeden silindi');
          }
        });

        container.appendChild(card);
      });
    }

    addToReadItem(title, note) {
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) {
        this.showToast('Lütfen kitap adı gir!');
        return;
      }

      const newItem = {
        id: 'tr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: cleanTitle,
        note: (note || '').trim(),
        createdAt: Date.now()
      };

      this.toreadList.unshift(newItem);
      Storage.saveReadingList(this.toreadList);
      this.dom.toreadTitle.value = '';
      this.dom.toreadNote.value = '';
      this.renderToReadList();
      this.showToast('Okuyacaklarıma eklendi!');
    }

    promoteToReadToFinished(id) {
      const item = this.toreadList.find(t => t.id === id);
      if (!item) return;

      const defaultDate = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      const promptNote = prompt(`"${item.title}" Okuduklarım listesine taşınsın.\nİsteğe bağlı bir not veya bitirme tarihi ekleyebilirsin:`, item.note || `${defaultDate} tarihinde bitirildi.`);
      if (promptNote === null) return;

      this.toreadList = this.toreadList.filter(t => t.id !== id);
      Storage.saveReadingList(this.toreadList);
      this.renderToReadList();

      const newFinished = {
        id: 'fn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: item.title,
        note: promptNote.trim(),
        createdAt: Date.now()
      };
      this.finishedList.unshift(newFinished);
      Storage.saveArchive(this.finishedList);
      this.renderFinishedList();

      this.showToast('Kitap "Okuduklarım" listesine taşındı!');
    }

    editToReadItem(id) {
      const item = this.toreadList.find(t => t.id === id);
      if (!item) return;

      const newTitle = prompt('Kitap Adı:', item.title);
      if (newTitle === null) return;
      const newNote = prompt('Kişisel Not:', item.note || '');
      if (newNote === null) return;

      item.title = newTitle.trim() || item.title;
      item.note = newNote.trim();
      Storage.saveReadingList(this.toreadList);
      this.renderToReadList();
      this.showToast('Güncellendi');
    }

    renderFinishedList() {
      const container = this.dom.finishedListContainer;
      container.innerHTML = '';

      if (this.finishedList.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--muted); text-align: center; padding: 18px 0;">Henüz bitirilen kitap arşivinde kayıt yok.<br>Okuduğun kitapları ve notlarını buraya ekleyebilirsin.</div>';
        return;
      }

      this.finishedList.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'journal-card';
        const dateStr = new Date(item.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

        card.innerHTML = `
          <div class="journal-card-header">
            <div class="journal-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            <div class="journal-card-actions">
              <button class="btn-mini btn-rename" title="Notu Düzenle">✎</button>
              <button class="btn-mini btn-delete" title="Sil">×</button>
            </div>
          </div>
          ${item.note ? `<div class="journal-card-note">${escapeHtml(item.note)}</div>` : ''}
          <div class="journal-card-date">Kayıt: ${dateStr}</div>
        `;

        card.querySelector('.btn-rename').addEventListener('click', () => {
          this.editFinishedItem(item.id);
        });

        card.querySelector('.btn-delete').addEventListener('click', () => {
          if (confirm(`"${item.title}" kaydı arşivden silinsin mi?`)) {
            this.finishedList = this.finishedList.filter(f => f.id !== item.id);
            Storage.saveArchive(this.finishedList);
            this.renderFinishedList();
            this.showToast('Arşivden silindi');
          }
        });

        container.appendChild(card);
      });
    }

    addFinishedItem(title, note) {
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) {
        this.showToast('Lütfen kitap adı gir!');
        return;
      }

      const defaultDate = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      const cleanNote = (note || '').trim() || `${defaultDate} tarihinde okundu.`;

      const newItem = {
        id: 'fn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: cleanTitle,
        note: cleanNote,
        createdAt: Date.now()
      };

      this.finishedList.unshift(newItem);
      Storage.saveArchive(this.finishedList);
      this.dom.finishedTitle.value = '';
      this.dom.finishedNote.value = '';
      this.renderFinishedList();
      this.showToast('Okuduklarım arşivine eklendi!');
    }

    editFinishedItem(id) {
      const item = this.finishedList.find(f => f.id === id);
      if (!item) return;

      const newTitle = prompt('Kitap Adı:', item.title);
      if (newTitle === null) return;
      const newNote = prompt('Kişisel Not veya Tarih:', item.note || '');
      if (newNote === null) return;

      item.title = newTitle.trim() || item.title;
      item.note = newNote.trim();
      Storage.saveArchive(this.finishedList);
      this.renderFinishedList();
      this.showToast('Güncellendi');
    }

    addBook(title, text) {
      if (!text || !text.trim()) {
        this.showToast('Lütfen metin gir!');
        return;
      }

      const tokens = tokenize(text);
      if (tokens.length === 0) {
        this.showToast('Okunabilir kelime bulunamadı!');
        return;
      }

      const cleanTitle = (title && title.trim()) || `Metin (${new Date().toLocaleDateString('tr-TR')} ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`;
      const newBook = {
        id: 'book_' + Date.now(),
        title: cleanTitle,
        text: text.trim(),
        wordCount: tokens.length,
        index: 0,
        finished: false,
        updatedAt: Date.now()
      };

      this.books.unshift(newBook);
      const saved = Storage.saveBooks(this.books);

      this.dom.addTitle.value = '';
      this.dom.addText.value = '';
      this.loadBook(newBook.id);
      this.toggleDrawer(false);
      if (!saved) {
        this.showToast('Uyarı: Hafıza dolu, metin kalıcı kaydedilemedi!');
      } else {
        this.showToast('Metin eklendi!');
      }
    }

    // --- File Import & Cleaning Flow ---
    async handleFileImport(file) {
      if (!file) return;
      const isEpub = file.name.toLowerCase().endsWith('.epub');
      if (isEpub) {
        try {
          this.showToast('EPUB ayrıştırılıyor...');
          const buffer = await file.arrayBuffer();
          const parsed = await EpubReader.parse(buffer);
          this.showImportPreview(parsed);
        } catch (err) {
          console.error(err);
          this.showToast('EPUB açılamadı: ' + err.message);
        }
        return;
      }

      // TXT file handling
      const reader = new FileReader();
      reader.onload = (event) => {
        const rawText = event.target.result;
        const bookTitle = file.name.replace(/\.[^/.]+$/, '');
        this.showTxtImportPreview(bookTitle, rawText);
      };
      reader.readAsText(file);
    }

    showImportPreview(importData) {
      this.pendingImport = importData;
      this.dom.addFormSection.style.display = 'none';
      this.dom.importPreviewSection.style.display = 'flex';
      this.dom.importTitleInput.value = importData.title || '';
      this.applyImportPreset('main');
    }

    closeImportPreview() {
      this.pendingImport = null;
      this.dom.importPreviewSection.style.display = 'none';
      this.dom.addFormSection.style.display = 'flex';
      this.dom.filePicker.value = '';
    }

    renderImportSectionList() {
      if (!this.pendingImport) return;
      const container = this.dom.importSectionList;
      container.innerHTML = '';

      this.pendingImport.sections.forEach((sec, idx) => {
        const item = document.createElement('div');
        item.className = 'import-section-item';

        const badgeClass = (sec.type === 'body') ? 'badge-body' : 'badge-trim';
        const typeLabels = {
          cover: 'Kapak',
          copyright: 'Künye',
          toc: 'İçindekiler',
          preface: 'Önsöz',
          body: 'Bölüm',
          back: 'Son Kısım'
        };

        item.innerHTML = `
          <div class="import-section-item-left">
            <input type="checkbox" id="sec-chk-${idx}" ${sec.selected ? 'checked' : ''}>
            <div style="display: flex; flex-direction: column; overflow: hidden;">
              <label for="sec-chk-${idx}" style="cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">
                ${escapeHtml(sec.title)}
              </label>
              ${sec.snippet ? `<span style="font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">"${escapeHtml(sec.snippet)}..."</span>` : ''}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <span class="import-section-badge ${badgeClass}">${typeLabels[sec.type] || 'Bölüm'}</span>
            <span style="font-size: 11px; color: var(--muted);">${formatNumber(sec.wordCount)} k.</span>
          </div>
        `;

        const chk = item.querySelector('input');
        chk.addEventListener('change', (e) => {
          sec.selected = e.target.checked;
          this.updateImportStats();
        });

        container.appendChild(item);
      });

      this.updateImportStats();
    }

    updateImportStats() {
      if (!this.pendingImport) return;
      const selectedSections = this.pendingImport.sections.filter(s => s.selected);
      const selectedWords = selectedSections.reduce((sum, s) => sum + s.wordCount, 0);
      const totalWords = this.pendingImport.sections.reduce((sum, s) => sum + s.wordCount, 0);

      this.dom.importBookStats.textContent = `${this.pendingImport.author ? this.pendingImport.author + ' · ' : ''}Seçili: ${formatNumber(selectedWords)} / ${formatNumber(totalWords)} kelime (${selectedSections.length} bölüm)`;
    }

    applyImportPreset(preset) {
      if (!this.pendingImport) return;
      this.dom.presetMain.classList.toggle('active', preset === 'main');
      this.dom.presetPreface.classList.toggle('active', preset === 'preface');
      this.dom.presetAll.classList.toggle('active', preset === 'all');

      this.pendingImport.sections.forEach(sec => {
        if (preset === 'main') {
          sec.selected = (sec.type === 'body');
        } else if (preset === 'preface') {
          sec.selected = (sec.type === 'body' || sec.type === 'preface');
        } else if (preset === 'all') {
          sec.selected = true;
        }
      });
      this.renderImportSectionList();
    }

    confirmImport() {
      if (!this.pendingImport) return;
      const title = this.dom.importTitleInput.value.trim() || this.pendingImport.title;
      const selectedSections = this.pendingImport.sections.filter(s => s.selected);

      if (selectedSections.length === 0) {
        this.showToast('Lütfen en az bir bölüm seç!');
        return;
      }

      const rawAssembled = selectedSections.map(s => s.text).join('\n\n');
      const cleaned = TextCleaner.clean(rawAssembled, {
        fixHyphenation: this.dom.cleanRuleHyphen.checked,
        removeFootnotes: this.dom.cleanRuleFootnotes.checked,
        removePageNumbers: this.dom.cleanRulePages.checked,
        collapseWhitespace: true
      });

      this.closeImportPreview();
      this.addBook(title, cleaned);
    }

    showTxtImportPreview(title, rawText) {
      const lines = rawText.split(/\r?\n/);
      const sections = [];
      let currentSection = { title: 'Giriş', type: 'body', selected: true, lines: [] };

      const chapterHeadingRegex = /^(?:bölüm|chapter|kısım|\d+\. bölüm|[ivxlcdm]+\. bölüm)\b/i;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 50 && chapterHeadingRegex.test(trimmed)) {
          if (currentSection.lines.length > 0) {
            const secText = currentSection.lines.join('\n').trim();
            sections.push({
              id: 'sec_' + sections.length,
              title: currentSection.title,
              type: currentSection.type,
              selected: true,
              text: secText,
              wordCount: secText.split(/\s+/).filter(w => w.length > 0).length
            });
          }
          currentSection = { title: trimmed, type: 'body', selected: true, lines: [] };
        } else {
          currentSection.lines.push(line);
        }
      }

      if (currentSection.lines.length > 0) {
        const secText = currentSection.lines.join('\n').trim();
        sections.push({
          id: 'sec_' + sections.length,
          title: currentSection.title,
          type: currentSection.type,
          selected: true,
          text: secText,
          wordCount: secText.split(/\s+/).filter(w => w.length > 0).length
        });
      }

      if (sections.length <= 1) {
        const cleaned = TextCleaner.clean(rawText);
        this.addBook(title, cleaned);
        return;
      }

      this.showImportPreview({ title, author: '', sections });
    }

    // --- Metin Gezgini / Paragraph Explorer ---
    openTextViewer() {
      if (!this.currentBook || this.tokens.length === 0) {
        this.showToast('Önce bir metin seç!');
        return;
      }
      if (this.isPlaying) {
        this.pause();
      }
      this.dom.textViewerBookTitle.textContent = this.currentBook.title;
      this.dom.textViewerSearch.value = '';
      this.dom.btnClearSearch.style.display = 'none';
      this.selectedParagraphIndex = null;
      this.dom.textViewerActionBar.style.display = 'none';

      this.prepareParagraphs();
      this.renderParagraphs();

      this.dom.textViewerBackdrop.style.display = 'block';
      this.dom.textViewerModal.style.display = 'flex';

      // Auto-scroll to current reading paragraph
      setTimeout(() => {
        const activeEl = this.dom.textViewerContent.querySelector('.active-cur');
        if (activeEl) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);
    }

    closeTextViewer() {
      this.dom.textViewerBackdrop.style.display = 'none';
      this.dom.textViewerModal.style.display = 'none';
      this.selectedParagraphIndex = null;
    }

    prepareParagraphs() {
      const rawParas = (this.currentBook.text || '')
        .split(/\r?\n\s*\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      let wordCount = 0;
      this.cachedParagraphs = rawParas.map((p, idx) => {
        const wList = p.split(/\s+/).filter(w => w.length > 0);
        const start = wordCount;
        const end = Math.max(start, start + wList.length - 1);
        wordCount += wList.length;
        return {
          index: idx,
          text: p,
          startWord: start,
          endWord: end,
          wordCount: wList.length
        };
      });
    }

    renderParagraphs(filterQuery = '') {
      const container = this.dom.textViewerContent;
      container.innerHTML = '';

      const query = (filterQuery || '').trim().toLowerCase();
      let matchCount = 0;
      const fragment = document.createDocumentFragment();

      this.cachedParagraphs.forEach(p => {
        if (query && !p.text.toLowerCase().includes(query)) {
          return;
        }
        matchCount++;

        const isCurrent = (p.startWord <= this.currentIndex && this.currentIndex <= p.endWord);
        const isSelected = (this.selectedParagraphIndex === p.index);

        const el = document.createElement('div');
        el.className = 'text-viewer-para' + (isCurrent ? ' active-cur' : '') + (isSelected ? ' selected-target' : '');
        el.setAttribute('data-index', p.index);

        let displayText = escapeHtml(p.text);
        if (query) {
          try {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, 'gi');
            displayText = displayText.replace(regex, '<mark style="background-color: var(--accent); color: var(--on-accent); border-radius: 2px; padding: 0 2px;">$1</mark>');
          } catch (e) {
            // Fallback: plain text without mark if regex fails
          }
        }

        el.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span class="para-num">Paragraf #${p.index + 1} · ${formatNumber(p.startWord + 1)}. kelime (${formatNumber(p.wordCount)} k.)</span>
            ${isCurrent ? '<span class="para-badge-cur">Şu An Buradasın</span>' : ''}
          </div>
          <div>${displayText}</div>
        `;

        el.addEventListener('click', () => {
          this.selectParagraph(p.index);
        });

        fragment.appendChild(el);
      });

      if (matchCount === 0) {
        container.innerHTML = '<div style="font-size: 13px; color: var(--muted); text-align: center; padding: 30px 0;">Aramaya uygun paragraf bulunamadı.</div>';
      } else {
        container.appendChild(fragment);
      }
    }

    selectParagraph(pIndex) {
      this.selectedParagraphIndex = pIndex;
      const p = this.cachedParagraphs[pIndex];
      if (!p) return;

      const allParas = this.dom.textViewerContent.querySelectorAll('.text-viewer-para');
      allParas.forEach(el => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        el.classList.toggle('selected-target', idx === pIndex);
      });

      this.dom.actionParaIndicator.textContent = `Seçili: Paragraf #${p.index + 1} (${formatNumber(p.startWord + 1)}. kelime)`;
      this.dom.textViewerActionBar.style.display = 'flex';
    }

    jumpToSelectedParagraph() {
      if (this.selectedParagraphIndex === null) return;
      const p = this.cachedParagraphs[this.selectedParagraphIndex];
      if (!p) return;

      this.currentIndex = p.startWord;
      this.saveCurrentBookProgress();
      this.updateDisplay();
      this.closeTextViewer();
      this.showToast(`Atlandı: Paragraf #${p.index + 1}`);
    }

    trimBeforeSelectedParagraph() {
      if (this.selectedParagraphIndex === null || this.selectedParagraphIndex === 0) {
        this.showToast('Bu paragraftan önce silinecek bir metin yok!');
        return;
      }
      const p = this.cachedParagraphs[this.selectedParagraphIndex];
      if (!p) return;

      const confirmMsg = `Paragraf #${p.index + 1}'den önceki ${formatNumber(p.startWord)} kelimelik giriş / biyografi kısmı kitaptan kalıcı olarak silinsin mi?`;
      if (!confirm(confirmMsg)) return;

      const keptParas = this.cachedParagraphs.slice(p.index).map(item => item.text);
      const newCleanedText = keptParas.join('\n\n');

      this.currentBook.text = newCleanedText;
      this.tokens = tokenize(newCleanedText);
      this.currentIndex = 0;
      this.currentBook.index = 0;
      this.currentBook.wordCount = this.tokens.length;
      this.currentBook.updatedAt = Date.now();

      const saved = Storage.saveBooks(this.books);
      this.closeTextViewer();
      this.updateDisplay();
      this.renderBookList();
      if (!saved) {
        this.showToast('Giriş temizlendi (Hafıza dolu, kalıcı kaydedilemedi)!');
      } else {
        this.showToast('Giriş kısmı temizlendi! Kitap başlangıçtan açıldı.');
      }
    }

    deleteSelectedParagraph() {
      if (this.selectedParagraphIndex === null) {
        this.showToast('Lütfen önce silinecek bir paragraf seç!');
        return;
      }
      const p = this.cachedParagraphs[this.selectedParagraphIndex];
      if (!p) return;

      const confirmMsg = `Paragraf #${p.index + 1} (${formatNumber(p.wordCount)} kelime) kitaptan tamamen silinsin mi?`;
      if (!confirm(confirmMsg)) return;

      // Adjust reader current index
      if (this.currentIndex >= p.startWord && this.currentIndex <= p.endWord) {
        this.currentIndex = p.startWord;
      } else if (this.currentIndex > p.endWord) {
        this.currentIndex = Math.max(0, this.currentIndex - p.wordCount);
      }

      // Filter out this paragraph
      const remainingParas = this.cachedParagraphs
        .filter(item => item.index !== p.index)
        .map(item => item.text);

      const newCleanedText = remainingParas.join('\n\n');

      this.currentBook.text = newCleanedText;
      this.tokens = tokenize(newCleanedText);
      this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.tokens.length - 1));
      this.currentBook.index = this.currentIndex;
      this.currentBook.wordCount = this.tokens.length;
      this.currentBook.updatedAt = Date.now();

      const saved = Storage.saveBooks(this.books);

      // Refresh paragraphs in the open viewer without closing
      this.prepareParagraphs();
      this.selectedParagraphIndex = null;
      this.dom.textViewerActionBar.style.display = 'none';
      this.renderParagraphs(this.dom.textViewerSearch.value);

      this.updateDisplay();
      this.renderBookList();
      if (!saved) {
        this.showToast('Paragraf silindi (Hafıza dolu, kalıcı kaydedilemedi)!');
      } else {
        this.showToast('Paragraf kitaptan silindi!');
      }
    }

    // --- Touch & Keyboard Event Bindings ---
    bindEvents() {
      // Top bar & Drawer toggles
      this.dom.btnDrawer.addEventListener('click', () => this.toggleDrawer(true));
      this.dom.btnCloseDrawer.addEventListener('click', () => this.toggleDrawer(false));
      this.dom.drawerBackdrop.addEventListener('click', () => this.toggleDrawer(false));
      this.dom.topTitle.addEventListener('click', () => {
        this.toggleDrawer(true);
        this.switchTab('books');
      });

      this.dom.btnTheme.addEventListener('click', () => this.toggleTheme());
      this.dom.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

      // Metin Gezgini events
      if (this.dom.btnTextViewer) {
        this.dom.btnTextViewer.addEventListener('click', () => this.openTextViewer());
      }
      if (this.dom.btnCloseTextViewer) {
        this.dom.btnCloseTextViewer.addEventListener('click', () => this.closeTextViewer());
      }
      if (this.dom.textViewerBackdrop) {
        this.dom.textViewerBackdrop.addEventListener('click', () => this.closeTextViewer());
      }
      if (this.dom.btnJumpHere) {
        this.dom.btnJumpHere.addEventListener('click', () => this.jumpToSelectedParagraph());
      }
      if (this.dom.btnDeletePara) {
        this.dom.btnDeletePara.addEventListener('click', () => this.deleteSelectedParagraph());
      }
      if (this.dom.btnTrimBefore) {
        this.dom.btnTrimBefore.addEventListener('click', () => this.trimBeforeSelectedParagraph());
      }
      if (this.dom.textViewerSearch) {
        this.dom.textViewerSearch.addEventListener('input', (e) => {
          const val = e.target.value;
          if (this.dom.btnClearSearch) {
            this.dom.btnClearSearch.style.display = val ? 'flex' : 'none';
          }
          this.renderParagraphs(val);
        });
      }
      if (this.dom.btnClearSearch) {
        this.dom.btnClearSearch.addEventListener('click', () => {
          this.dom.textViewerSearch.value = '';
          this.dom.btnClearSearch.style.display = 'none';
          this.renderParagraphs('');
        });
      }
      if (this.dom.bottomInfoLeft) {
        this.dom.bottomInfoLeft.style.cursor = 'pointer';
        this.dom.bottomInfoLeft.title = 'Metin Gezgini & Paragraflar (G)';
        this.dom.bottomInfoLeft.addEventListener('click', () => this.openTextViewer());
      }

      // Drawer Tabs
      this.dom.tabBtns.books.addEventListener('click', () => this.switchTab('books'));
      this.dom.tabBtns.add.addEventListener('click', () => this.switchTab('add'));
      this.dom.tabBtns.settings.addEventListener('click', () => this.switchTab('settings'));

      // Kitaplarım Sub-Tabs (Kütüphane / Okuyacaklarım / Okuduklarım)
      if (this.dom.subtabBtns) {
        this.dom.subtabBtns.loaded.addEventListener('click', () => this.switchSubTab('loaded'));
        this.dom.subtabBtns.toread.addEventListener('click', () => this.switchSubTab('toread'));
        this.dom.subtabBtns.finished.addEventListener('click', () => this.switchSubTab('finished'));
      }

      if (this.dom.btnAddToread) {
        this.dom.btnAddToread.addEventListener('click', () => {
          this.addToReadItem(this.dom.toreadTitle.value, this.dom.toreadNote.value);
        });
      }

      if (this.dom.btnAddFinished) {
        this.dom.btnAddFinished.addEventListener('click', () => {
          this.addFinishedItem(this.dom.finishedTitle.value, this.dom.finishedNote.value);
        });
      }

      // Add text actions
      this.dom.btnClipboard.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clipText = await navigator.clipboard.readText();
            if (clipText) {
              this.dom.addText.value = clipText;
              this.showToast('Panodan yapıştırıldı');
            }
          } else {
            this.showToast('Pano izni desteklenmiyor, metin kutusuna yapıştır');
          }
        } catch (err) {
          this.showToast('Panoya erişilemedi');
        }
      });

      this.dom.btnPickFile.addEventListener('click', () => {
        this.dom.filePicker.click();
      });

      this.dom.filePicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleFileImport(e.target.files[0]);
        }
      });

      this.dom.btnCancelImport.addEventListener('click', () => {
        this.closeImportPreview();
      });

      this.dom.presetMain.addEventListener('click', () => this.applyImportPreset('main'));
      this.dom.presetPreface.addEventListener('click', () => this.applyImportPreset('preface'));
      this.dom.presetAll.addEventListener('click', () => this.applyImportPreset('all'));

      this.dom.btnConfirmImport.addEventListener('click', () => {
        this.confirmImport();
      });

      // Drag and drop support on Add Text tab
      const dropZone = this.dom.tabContents.add;
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.outline = '2px dashed var(--accent)';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.outline = 'none';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.outline = 'none';
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          this.handleFileImport(e.dataTransfer.files[0]);
        }
      });

      this.dom.btnSaveText.addEventListener('click', () => {
        this.addBook(this.dom.addTitle.value, this.dom.addText.value);
      });

      // Settings Inputs
      this.dom.settingWpm.addEventListener('input', (e) => {
        this.setWpm(parseInt(e.target.value, 10), false);
      });

      this.dom.settingFont.addEventListener('input', (e) => {
        this.applyFontSize(parseInt(e.target.value, 10));
      });

      this.dom.settingCountdown.addEventListener('change', (e) => {
        this.settings.countdown = e.target.checked;
        Storage.saveSettings(this.settings);
      });

      this.dom.settingRewind.addEventListener('change', (e) => {
        this.settings.rewind = e.target.checked;
        Storage.saveSettings(this.settings);
      });

      this.dom.btnClearData.addEventListener('click', async () => {
        if (confirm('Tüm kitaplar, ayarlar ve önbellek sıfırlansın mı?')) {
          localStorage.clear();
          if ('caches' in window) {
            try {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            } catch (err) {}
          }
          location.reload();
        }
      });

      // Bottom bar control buttons
      this.dom.btnPlay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlay();
      });

      this.dom.btnSeekBack.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seek(-10);
      });

      this.dom.btnSeekFwd.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seek(10);
      });

      this.dom.btnWpmDown.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setWpm(this.settings.wpm - 25);
      });

      this.dom.btnWpmUp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setWpm(this.settings.wpm + 25);
      });

      // Scrubber progress bar
      const handleScrub = (e) => {
        const rect = this.dom.progressBarWrap.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        this.seekFraction(frac);
      };

      let isScrubbing = false;
      this.dom.progressBarWrap.addEventListener('pointerdown', (e) => {
        isScrubbing = true;
        handleScrub(e);
      });

      window.addEventListener('pointermove', (e) => {
        if (isScrubbing) {
          handleScrub(e);
        }
      });

      window.addEventListener('pointerup', () => {
        isScrubbing = false;
      });

      // Center viewport click & touch gestures (Swipe & Tap)
      let touchStartX = 0;
      let touchStartY = 0;
      let touchStartTime = 0;
      let lastTouchEndTime = 0;

      this.dom.readingViewport.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }, { passive: true });

      // Prevent browser rubber-banding and page slide on touch gestures
      this.dom.readingViewport.addEventListener('touchmove', (e) => {
        if (e.cancelable) {
          e.preventDefault();
        }
      }, { passive: false });

      this.dom.readingViewport.addEventListener('touchend', (e) => {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        lastTouchEndTime = Date.now();
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        const diffTime = Date.now() - touchStartTime;

        // If swipe gesture (> 45px distance and within 500ms)
        if (diffTime < 500 && (Math.abs(diffX) > 45 || Math.abs(diffY) > 45)) {
          if (Math.abs(diffX) > Math.abs(diffY)) {
            // Horizontal swipe: Seek
            if (diffX < 0) {
              this.seek(10); // Swipe left: Next 10 words
            } else {
              this.seek(-10); // Swipe right: Back 10 words
            }
          } else {
            // Vertical swipe: Speed
            if (diffY < 0) {
              this.setWpm(this.settings.wpm + 25); // Swipe up: Faster
            } else {
              this.setWpm(this.settings.wpm - 25); // Swipe down: Slower
            }
          }
          return;
        }

        // Tap gesture: responsive threshold (< 25px move and < 400ms)
        if (diffTime < 400 && Math.abs(diffX) < 25 && Math.abs(diffY) < 25) {
          this.togglePlay();
        }
      }, { passive: true });

      // Mouse click on desktop reading area
      this.dom.readingViewport.addEventListener('click', (e) => {
        // Prevent ghost click after touchend on touchscreen devices / hybrid laptops
        if (Date.now() - lastTouchEndTime < 450) {
          return;
        }
        this.togglePlay();
      });

      // Global keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        // If typing in textarea or input, do not capture hotkeys
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          return;
        }

        // If Text Viewer modal is open, Escape closes it
        if (this.dom.textViewerModal && this.dom.textViewerModal.style.display !== 'none') {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.closeTextViewer();
          }
          return;
        }

        // If drawer is open, only allow Escape to close it; ignore playback hotkeys
        if (this.dom.drawer.classList.contains('open')) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.toggleDrawer(false);
          }
          return;
        }

        if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          this.openTextViewer();
          return;
        }

        if (e.code === 'Space') {
          e.preventDefault();
          this.togglePlay();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          this.seek(-10);
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          this.seek(10);
        } else if (e.code === 'ArrowUp') {
          e.preventDefault();
          this.setWpm(this.settings.wpm + 25);
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          this.setWpm(this.settings.wpm - 25);
        } else if (e.code === 'Escape') {
          e.preventDefault();
          if (this.dom.drawer.classList.contains('open')) {
            this.toggleDrawer(false);
          } else if (this.isPlaying) {
            this.pause();
          }
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.currentIndex = 0;
          this.saveCurrentBookProgress();
          this.updateDisplay();
          this.showToast('Başa sarıldı');
        }
      });
    }

    // --- PWA Service Worker Registration ---
    registerServiceWorker() {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('./sw.js').then((reg) => {
            console.log('[fast-read] Service Worker registered:', reg.scope);

            // Check for updates immediately and periodically
            reg.update().catch(() => {});

            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'visible') {
                reg.update().catch(() => {});
              }
            });
          }).catch((err) => {
            console.log('[fast-read] Service Worker registration failed:', err);
          });

          // Auto-refresh when new Service Worker takes over
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
              refreshing = true;
              window.location.reload();
            }
          });
        });
      }
    }
  }

  // Initialize on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    window.fastRead = new FastReadWeb();
  });
})();
