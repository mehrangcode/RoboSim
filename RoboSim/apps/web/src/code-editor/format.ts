/**
 * Formats sketch code with clang-format (FR-COD-05) in Arduino IDE 2's style
 * (`arduino.clang-format`, from arduino/tooling-project-assets). The WASM build (~2.5 MB) loads on
 * first use, in its own chunk.
 */
let ready:
  Promise<{ format: (source: string, file: string, style: string) => string; style: string }> | undefined;

function load() {
  ready ??= Promise.all([import('@wasm-fmt/clang-format/vite'), import('./arduino.clang-format?raw')]).then(
    async ([clang, style]) => {
      await clang.default();
      return { format: clang.format, style: style.default };
    },
  );
  // A failed load (offline) may be retried.
  ready.catch(() => {
    ready = undefined;
  });
  return ready;
}

/** clang-format infers the language from the name; `.ino` is C++. */
export const formatterFileName = (name: string) => (name.endsWith('.ino') ? `${name}.cpp` : name);

/** Formatted source; throws when the formatter cannot load or the code cannot be parsed. */
export async function formatSketch(source: string, fileName: string): Promise<string> {
  const { format, style } = await load();
  return format(source, formatterFileName(fileName), style);
}
