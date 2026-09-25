// تخزين إعدادات الأرقام بملف JSON (كتابة ذرّية: ملف مؤقت ثم rename)
const fs = require("fs");
const path = require("path");

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "instances.json");
    fs.mkdirSync(dataDir, { recursive: true });
    this.items = {};
    if (fs.existsSync(this.file)) this.items = JSON.parse(fs.readFileSync(this.file, "utf8") || "{}");
  }

  all() { return Object.values(this.items); }
  get(id) { return this.items[id] || null; }

  put(meta) {
    this.items[meta.id] = meta;
    this._save();
    return meta;
  }

  remove(id) {
    delete this.items[id];
    this._save();
  }

  _save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
