// What is dropped around an API key, a signing secret and the value of a
// signature header: what a file or a header puts there, and no more.
// `trim` drops more (a byte order mark, a no-break space), other
// languages drop other things, and one value must read the same in every
// client.
export const around = " \t\r\n";

/** A value without the space, tabs and line breaks around it. */
export function bare(value: string): string {
  let from = 0;
  let to = value.length;
  while (from < to && around.includes(value.charAt(from))) from++;
  while (to > from && around.includes(value.charAt(to - 1))) to--;
  return value.slice(from, to);
}
