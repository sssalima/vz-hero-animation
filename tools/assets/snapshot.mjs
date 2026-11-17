/**
 * Save the review contact sheet as PNGs (one per slot) without opening a browser:
 *
 *   node tools/assets/snapshot.mjs [slot ...]      -> tools/assets/_review/sheet/<slot>.png
 *
 * Uses the running dev server (DEV_URL, default http://localhost:3000) and the system
 * Chromium (CHROME, default /usr/bin/chromium).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import puppeteer from "puppeteer-core"
import { readManifest } from "./fetch.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "_review", "sheet")
const BASE = process.env.DEV_URL || "http://localhost:3000"

const slots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(readManifest().slots)
fs.mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
})
try {
  for (const slot of slots) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1480, height: 900 })
    page.on("pageerror", (e) => console.log(`  ${slot}: ${e.message}`))
    await page.goto(`${BASE}/tools/assets/review.html?slot=${slot}`, {
      waitUntil: "load",
    })
    await page.waitForFunction("window.__done === true", { timeout: 240000 })
    await new Promise((r) => setTimeout(r, 300))
    const el = await page.$("section")
    await el.screenshot({ path: path.join(OUT, `${slot}.png`) })
    await page.close()
    console.log(`ok ${slot}`)
  }
} finally {
  await browser.close()
}
