const PDF_NAME_TOKEN = /\/[^\x00\t\n\f\r ()<>\[\]{}\/%]+/g;

export function findActivePdfMarker(source: string, markers: readonly string[]) {
  const matchedNames = new Set<string>();
  const tokens = new RegExp(PDF_NAME_TOKEN);
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(source)) !== null) {
    // Decode only after tokenizing: escaped slashes/spaces stay inside the name.
    const decodedName = token[0].replace(/#([0-9a-f]{2})/gi, (_match: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (markers.includes(decodedName)) matchedNames.add(decodedName);
  }
  return markers.find((marker) => matchedNames.has(marker)) || null;
}
