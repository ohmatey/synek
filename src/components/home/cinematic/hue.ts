// A stable hue (0–359) derived from a string — gives projects and image-less story
// covers a recognizable, evenly-spread identity color with no stored color field.
// Same string → same hue across sessions and surfaces.
export function hueFromString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}
