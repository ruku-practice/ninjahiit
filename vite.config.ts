import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  // GitHub Pagesのサブパス(/ninjahiit/)配下でも動くよう相対ベース
  base: "./",
  build: {
    outDir: "docs",       // GitHub Pages(main /docs)がそのまま配信する
    assetsDir: "bundle",  // public/assets/ と衝突しないようバンドル置き場は別名に
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
