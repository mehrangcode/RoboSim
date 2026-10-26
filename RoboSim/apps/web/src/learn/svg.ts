/** An inline SVG as an image URL: drawn by <img>, so its markup never reaches the page. */
export const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
