# Loyiha starter — Obsidian + Backlog Board + AI agent

Bu papkani kompyuteringizdagi istalgan doimiy joyga (masalan, `C:\D\Projects\starter`) nusxalab qo'ying. Shundan keyin har qanday **yangi** yoki **yurib turgan** loyihani 2 qadamda shu tizimga ulaysiz:

1. **Loyihaga o'rnatish (1 buyruq):**
   ```powershell
   node C:\D\Projects\starter\setup.mjs C:\D\Projects\loyiha-nomi
   ```
   *(Ixtiyoriy: `--name "Loyiha nomi"` berishingiz mumkin. Mavjud fayllaringiz — masalan, oldindan bor `CLAUDE.md` yoki `community-plugins.json` — o'chirilmaydi.)*

2. **Obsidian'da ochish:**
   - **Open folder as vault** → `C:\D\Projects\loyiha-nomi` (`Backlog Board` plugini avtomatik yoqilgan bo'ladi).
   - `Ctrl+P` → **`Backlog Board: Doskani agent bilan ochish`** (chapda doska, o'ngda ACP agent paneli).

Keyinchalik faqat plugin kodini yangilash uchun (`data.json` sozlamalariga tegmasdan):
```powershell
node C:\D\Projects\starter\setup.mjs C:\D\Projects\loyiha-nomi --update-plugin
```

> Yurib turgan loyiha uchun `CLAUDE.md` ga loyihaning qisqa tavsifi va test/run buyruqlarini yozing, hamda `backlog task create "..."` bilan faqat oldinda turgan 3–10 ta real vazifani qo'shing.
