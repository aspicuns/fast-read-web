# fast-read (Web & PWA)

Minimalist, çevrimdışı öncelikli (Offline-First) ve sıfır kota tüketen **RSVP (Rapid Serial Visual Presentation)** hızlı okuma web uygulaması.

---

## 🚀 Özellikler

- **Sıfır İnternet Tüketimi (PWA):** İlk açılışta yalnızca ~70 KB indirilir ve Service Worker ile tamamen cihazına önbelleklenir. Sonrasında internetsiz / uçak modunda dahi kesintisiz çalışır.
- **Optik Tanıma Noktası (ORP):** Her kelimede gözün ilk odaklanması gereken harfi kırmızı renkle işaretler ve üst/alt çentiklerle tam merkezde hizalar.
- **Akıllı Hız Çarpanları:** Nokta, virgül, soru işareti ve uzun kelimelerde doğal okuma ritmini korumak için mikro duraklamalar uygular.
- **Tam Dokunmatik Deneyim (iOS & Android):**
  - **Ekrana Tek Dokunuş:** Başlat / Duraklat
  - **Sağa / Sola Kaydırma (Swipe):** 10 kelime ileri / geri sar
  - **Yukarı / Aşağı Kaydırma (Swipe):** Hız artır / azalt (±25 WPM)
- **Klavye Kısayolları (Masaüstü & iPad):**
  - `Boşluk`: Başlat / Duraklat
  - `Sol / Sağ Ok`: 10 kelime geri / ileri
  - `Yukarı / Aşağı Ok`: Hız ayarı (±25 WPM)
  - `R`: Başa sar
  - `Esc`: Duraklat / Menüyü kapat
- **Yerel Kütüphane:** Tüm kitaplar ve okuma ilerlemeleri telefonunun yerel hafızasında (`localStorage`) saklanır. Sunucuya hiçbir veri gönderilmez.
- **Karanlık / Aydınlık Tema:** Gözü yormayan saf minimalist tasarım.

---

## 📱 Telefona veya Tablete Kurulum (Ana Ekrana Ekleme)

### iPhone (iOS Safari)
1. Safari ile siteni aç.
2. Alttaki **Paylaş** (kare içinden yukarı çıkan ok) simgesine dokun.
3. Aşağı kaydırıp **"Ana Ekrana Ekle"** seçeneğini seç.
4. Artık adres çubuğu olmayan, internetsiz çalışan tam ekran bir uygulama olarak ana ekranında!

### Android & Tablet (Chrome)
1. Chrome ile siteni aç.
2. Sağ üstteki üç noktaya dokun veya alttan çıkan **"fast-read Uygulamasını Yükle"** butonuna bas.
3. Uygulama telefonunun uygulama çekmecesine ve ana ekranına eklenecektir.

---

## 🛡️ Gizlilik ve Güvenlik
- Sıfır harici kütüphane / framework (Saf HTML5, CSS3, Vanilla JS).
- Sıfır takipçi (tracker), sıfır analitik, sıfır reklam.
- %100 yerel ve açık kaynak.
