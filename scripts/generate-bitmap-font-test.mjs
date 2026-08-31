import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const GLYPHS = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
    "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
};

const CHARACTERS = ` ${Object.keys(GLYPHS).join("")}`;
const PIXEL_SCALE = 4;
const CELL_WIDTH = 24;
const CELL_HEIGHT = 32;
const COLUMNS = 8;
const ROWS = Math.ceil(CHARACTERS.length / COLUMNS);
const atlas = createCanvas(COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT);
const context = atlas.getContext("2d");
context.clearRect(0, 0, atlas.width, atlas.height);
context.fillStyle = "#ffffff";

const chars = [];
for (const [index, character] of [...CHARACTERS].entries()) {
    const x = (index % COLUMNS) * CELL_WIDTH;
    const y = Math.floor(index / COLUMNS) * CELL_HEIGHT;
    const pattern = GLYPHS[character];
    if (pattern) {
        for (const [row, pixels] of pattern.entries()) {
            for (const [column, pixel] of [...pixels].entries()) {
                if (pixel === "1") {
                    context.fillRect(
                        x + column * PIXEL_SCALE,
                        y + row * PIXEL_SCALE,
                        PIXEL_SCALE,
                        PIXEL_SCALE,
                    );
                }
            }
        }
    }
    chars.push(
        `char id=${character.codePointAt(0)} x=${x} y=${y} ` +
            `width=${character === " " ? 4 : 20} height=${character === " " ? 4 : 28} ` +
            `xoffset=0 yoffset=0 xadvance=${character === " " ? 12 : 24} page=0 chnl=15`,
    );
}

const descriptor = [
    'info face="NativePixel" size=28 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0',
    `common lineHeight=32 base=28 scaleW=${atlas.width} scaleH=${atlas.height} pages=1 packed=0`,
    'page id=0 file="native-pixel.png"',
    `chars count=${chars.length}`,
    ...chars,
    "kernings count=0",
    "",
].join("\n");

const outputDirectory = fileURLToPath(
    new URL("../assets/bitmap-font/", import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(`${outputDirectory}native-pixel.png`, atlas.toBuffer("image/png")),
    writeFile(`${outputDirectory}native-pixel.fnt`, descriptor, "utf8"),
]);

console.log({
    generated: "assets/bitmap-font/native-pixel.{fnt,png}",
    characters: chars.length,
    size: [atlas.width, atlas.height],
});
