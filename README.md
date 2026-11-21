# Loyiha starter — Obsidian + Backlog Board + AI agent

Har qanday **yangi** yoki **yurib turgan** loyihani bitta buyruq bilan shu tizimga ulaydi.

### 1. Onlayn (istalgan kompyuterda)
- **Loyihaga o'rnatish:**
  ```powershell
  npx github:obidovbek/backlog-starter C:\D\Projects\loyiha-nomi
  ```
  *(Loyiha papkasida turgan bo'lsangiz, yo'l o'rniga `.` yozing. Ixtiyoriy: `--name "Loyiha nomi"`. Mavjud `CLAUDE.md`, `.gitignore`, `community-plugins.json` ga tegmaydi.)*
- **Bitta loyihada pluginni yangilash** (`data.json` sozlamalariga tegmasdan):
  ```powershell
  npx github:obidovbek/backlog-starter C:\D\Projects\loyiha-nomi --update-plugin
  ```
- **Bir papkadagi barcha loyihalarda pluginni yangilash:**
  ```powershell
  npx github:obidovbek/backlog-starter --update-all C:\D\Projects
  ```

### 2. Mahalliy (internetsiz)
```powershell
node C:\D\Projects\backlog-starter\setup.mjs C:\D\Projects\loyiha-nomi
```

### 3. Obsidian'da ochish
- **Open folder as vault** → loyiha papkasi (`Backlog Board` yoqilgan bo'ladi).
- `Ctrl+P` → **`Backlog Board: Doskani agent bilan ochish`** (chapda doska, o'ngda agent paneli).

> Yurib turgan loyiha uchun `CLAUDE.md` ga qisqa tavsif va test/run buyruqlarini yozing, hamda `backlog task create "..."` bilan faqat oldinda turgan 3–10 ta real vazifani qo'shing.
