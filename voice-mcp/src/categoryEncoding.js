export const encodeCategory = (cat) => {
  return cat.replace(/\//g, '___SLASH___')
    .replace(/\./g, '___DOT___')
    .replace(/#/g, '___HASH___')
    .replace(/\$/g, '___DOLLAR___')
    .replace(/\[/g, '___LBRACKET___')
    .replace(/\]/g, '___RBRACKET___');
};

export const decodeCategory = (encoded) => {
  return encoded.replace(/___SLASH___/g, '/')
    .replace(/___DOT___/g, '.')
    .replace(/___HASH___/g, '#')
    .replace(/___DOLLAR___/g, '$')
    .replace(/___LBRACKET___/g, '[')
    .replace(/___RBRACKET___/g, ']');
};
