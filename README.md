# SIMA Auto Absen Bot

Bot Discord untuk sistem absensi otomatis pada platform e-learning SIMA UNSIQ dengan fitur auto-login, OCR CAPTCHA solving, dan notifikasi real-time.

## Fitur

- **Auto-Login** - Login otomatis dengan OCR CAPTCHA solving
- **Auto-Absen** - Absensi mandiri otomatis pada materi baru
- **Real-time Notifications** - Notifikasi Discord untuk materi baru & absensi
- **Statistics Tracking** - Statistik kehadiran dan aktivitas
- **Data Encryption** - Enkripsi AES-256-GCM untuk data sensitif
- **Scheduled Checks** - Pengecekan berkala setiap 10 menit
- **User Install Support** - Dapat digunakan di mana saja (DM/Server)

## Required

- Node.js >= `24.0.0`/latest
- npm or yarn
- Discord Bot Token with User Install enabled

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/zuna107/SIMA-Auto-Absen-Bot.git
cd SIMA-Auto-Absen-Bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment Variables

Copy `.env.example` menjadi `.env` dan isi dengan data mu:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_bot_client_id
OWNER_ID=your_discord_user_id
ENCRYPTION_KEY=your-secure-32-character-minimum-key
NODE_ENV=production
```

### 4. Setup Discord Bot

1. Buka [Discord Developer Portal](https://discord.com/developers/applications)
2. Buat aplikasi baru atau gunakan yang sudah ada
3. Pada tab **Bot**, aktifkan bot dan copy token
4. Pada tab **Installation**:
   - Enable **User Install**
   - Set scopes: `applications.commands`
   - Copy **Install Link** dan authorize.
5. Masuk tab **Bot** enable key:
    - Public Bot
    - Presence Intent
    - Server Members Intent
    - Message Content Intent


### 5. Start Bot

```bash
npm start
```

Untuk development dengan auto-reload:

```bash
npm run dev
```

## Project Structure

```
sima-absen-bot/
├── commands/           # Slash commands
│   ├── absen.js       # Registration command
│   └── status.js      # Status check command
├── connection/        # SIMA web interactions
│   ├── simaClient.js  # Main SIMA client
│   └── userManager.js # User data management
├── handlers/          # Event & command handlers
│   └── commandsHandler.js
├── services/          # Background services
│   ├── scheduler.js   # Cron job scheduler
│   └── notifier.js    # Discord notifications
├── utils/            # Utilities
│   └── logger.js     # Logging system
├── public/           # Data storage
│   ├── user.json     # User data (encrypted)
│   ├── lastMateri.json # Material cache
│   └── logs/         # Log files
├── config.js         # Configuration
├── index.js          # Main entry point
├── package.json
└── .env             # Environment variables
```

## Usage

### Commands

#### `/absen`
Mendaftarkan akun SIMA untuk sistem absensi otomatis.

**Flow:**
1. User menjalankan `/absen`
2. Bot menampilkan modal form
3. User memasukkan NIM dan password
4. Bot melakukan login dan verifikasi
5. Data disimpan dengan enkripsi
6. Sistem mulai monitoring

#### `/status`
Melihat status akun dan statistik absensi.

**Informasi yang ditampilkan:**
- Status akun (aktif/nonaktif)
- NIM dan username
- Waktu registrasi dan aktivitas
- Statistik (total cek, absensi, success rate)
- Konfigurasi sistem

## 🔧 Configuration

Edit `config.js` untuk mengubah konfigurasi:

```javascript
  // Discord configuration
  token: process.env.DISCORD_TOKEN,
  //masuk ke tab General Information pada Discord Developer Portal, copy Application ID
  clientId: process.env.CLIENT_ID || 'ISI_DENGAN_ID_BOT',
  ownerId: process.env.OWNER_ID || 'ID_DISCORD_ACCOUNT', //ID akun discord mu
```

```javascript
//jika ingin mengubah durasi pengecekan
scheduler: {
  interval: 10, // Check every 10 minutes
  cronExpression: '*/10 * * * *',
}
```

## 🔒 Security Features

### Enkripsi Data
- Password dan cookies dienkripsi menggunakan AES-256-GCM
- Encryption key disimpan di environment variable
- Auth tag untuk verifikasi integritas data

### Session Management
- Cookie session disimpan dan di-refresh otomatis
- Auto re-login jika session expired
- Timeout protection

## How It Works

### 1. Registration Flow
```
User → /absen → Modal Form → Login Attempt → OCR CAPTCHA
→ Verify Login → Save Data → Start Monitoring
```

### 2. Monitoring Flow
```
Scheduler (10 min) → Check All Active Users
→ Fetch Makul → Fetch Materi → Compare with Cache
→ If New Materi → Send Notification → Auto Absen (if applicable)
→ Verify Absen → Update Stats → Save Cache
```

### 3. Auto-Absen Logic
```
New Materi Detected → Check Type (Manual/Self)
→ If Self & Active → Access Discussion Page
→ Verify in Absen List → Send Success Notification
```

## Troubleshooting

### Bot tidak login ke SIMA
- Pastikan NIM dan password benar
- Check internet connection
- Lihat logs di `public/logs/`

### CAPTCHA solving gagal
- Tesseract.js memiliki akurasi ~80-90%
- System akan retry hingga 3x
- Jika terus gagal, mungkin format CAPTCHA berubah

### Session expired terus-menerus
- Check cookie expiration time
- Pastikan sistem tidak diblokir oleh SIMA
- Gunakan random delays untuk menghindari rate limit

### Bot tidak meninggalkan server
- Bot akan otomatis leave saat ditambahkan ke server
- Ini untuk memastikan bot hanya digunakan via User Install

## 📝 Logs

Log file disimpan di `public/logs/` jika ingin peninjauan lebih lanjut.

Log otomatis di-cleanup setelah 1 hari.

**Log levels:**
- `INFO` - Informasi umum
- `SUCCESS` - Operasi berhasil
- `WARN` - Warning/peringatan
- `ERROR` - Error/kesalahan
- `DEBUG` - Debug info (hanya di development)

## ⚠️ Important Notes

### Rate Limiting
- Implementasikan random delays antara requests
- Jangan terlalu sering melakukan requests
- Default: 1-3 detik random delay

### Cookie Management
- Cookies disimpan terenkripsi
- Auto-refresh saat expired
- Session timeout: 1 jam default

### Data Privacy
- Password dienkripsi dengan AES-256-GCM
- Data tidak pernah di-log dalam plaintext
- Hanya user yang bisa akses datanya sendiri

## 🔄 Updates & Maintenance

### Update Bot
```bash
git pull
npm install
npm start
```

### Clean Old Logs
Logs otomatis di-cleanup, atau manual:

Linux:
```bash
rm -rf public/logs/*.log
```
Windows:
```bash
del /S /Q public\logs\*.log
```

### Backup User Data
```bash
cp public/user.json public/user.json.backup
```

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## License

MIT License - [see LICENSE file](https://github.com/zuna107/SIMA-Auto-Absen-Bot/blob/main/LICENSE)

## Support

Jika mengalami masalah:
1. Check logs di `public/logs/`
2. Check console output
3. Buat issue di GitHub: [Issue](https://github.com/zuna107/SIMA-Auto-Absen-Bot/issues)
4. Contact developer: [zetsuna0447 on discord](https://discordapp.com/users/948093919835590666)

## Performance Tips

- Pastikan koneksi internet stabil
- Monitor memory usage (penggunaan Tesseract.js)
- Clean old data secara berkala

## Future Plans

- [ ] Web dashboard untuk monitoring
- [ ] Multi-account support
- [ ] Multi Lang
- [ ] Advanced statistics & analytics
- [ ] Custom notification settings
- [ ] Webhook integration
- [ ] API endpoint
- [ ] Mobile app [WPA]

---

If you need technical support, please contact me via Discord: **[zetsuna0447](https://discordapp.com/users/948093919835590666)**