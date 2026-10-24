/**
 * fast-read Web & PWA Engine
 * Minimalist, Offline-First RSVP Speed Reading
 */

(() => {
  'use strict';

  // --- Constants & Config ---
  const APP_VERSION = 'v1.2.1';

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
    const lastChar = word.slice(-1);
    if (['.', '!', '?', ':'].includes(lastChar)) {
      return 2.2;
    }
    if ([',', ';', '-', '—', '"', '”', '»'].includes(lastChar)) {
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
        appVersion: document.getElementById('app-version')
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
        if (this.settings.rewind && this.currentIndex > 3) {
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
      if (!this.isPlaying) return;

      if (this.currentIndex >= this.tokens.length) {
        this.currentIndex = Math.max(0, this.tokens.length - 1);
        this.pause();
        this.dom.readingHint.textContent = 'Bitti · Baştan başlamak için dokun';
        return;
      }

      const token = this.tokens[this.currentIndex];
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

      // Auto-fit long words on narrow screens so they never clip or shift
      const maxSideChars = Math.max(orpIdx, (totalLen - 1) - orpIdx);
      if (maxSideChars > 7) {
        const scale = Math.max(0.62, 7.5 / maxSideChars);
        this.dom.wordDisplay.style.transform = `scale(${scale.toFixed(3)})`;
      } else {
        this.dom.wordDisplay.style.transform = '';
      }
    }

    updateDisplay() {
      if (this.tokens.length === 0) {
        this.renderWord('fast', 1);
        this.dom.readingHint.textContent = 'Soldan metin seç veya ekle';
        this.updateProgressUi();
        return;
      }

      const token = this.tokens[this.currentIndex] || this.tokens[0];
      this.renderWord(token.text, token.orp);
      this.updateProgressUi();

      if (!this.isPlaying) {
        if (this.currentIndex >= this.tokens.length - 1) {
          this.dom.readingHint.textContent = 'Bitti · Baştan başlamak için dokun';
        } else {
          this.dom.readingHint.textContent = 'Dokunarak veya boşlukla başlat';
        }
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

      // Drawer Tabs
      this.dom.tabBtns.books.addEventListener('click', () => this.switchTab('books'));
      this.dom.tabBtns.add.addEventListener('click', () => this.switchTab('add'));
      this.dom.tabBtns.settings.addEventListener('click', () => this.switchTab('settings'));

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
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          this.dom.addText.value = event.target.result;
          if (!this.dom.addTitle.value) {
            this.dom.addTitle.value = file.name.replace(/\.[^/.]+$/, '');
          }
          this.showToast('Dosya yüklendi');
        };
        reader.readAsText(file);
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

        // If drawer is open, only allow Escape to close it; ignore playback hotkeys
        if (this.dom.drawer.classList.contains('open')) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.toggleDrawer(false);
          }
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
