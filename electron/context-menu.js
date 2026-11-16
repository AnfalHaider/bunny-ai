// Right-click menu template, kept free of Electron so it can be unit tested.
// `actions`: { replaceMisspelling(word), addToDictionary(word), copyLink(url) }
const MAX_SUGGESTIONS = 5;

export function buildContextMenuTemplate(params = {}, actions = {}) {
  const flags = params.editFlags || {};
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };

  if (params.misspelledWord) {
    const word = params.misspelledWord;
    const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    if (suggestions.length) {
      for (const s of suggestions) items.push({ label: s, click: () => actions.replaceMisspelling?.(s) });
    } else {
      items.push({ label: 'No suggestions', enabled: false });
    }
    items.push({ label: 'Add to dictionary', click: () => actions.addToDictionary?.(word) });
  }

  if (params.isEditable) {
    sep();
    items.push(
      { role: 'undo', enabled: !!flags.canUndo },
      { role: 'redo', enabled: !!flags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: !!flags.canCut },
      { role: 'copy', enabled: !!flags.canCopy },
      { role: 'paste', enabled: !!flags.canPaste },
      { role: 'selectAll', enabled: !!flags.canSelectAll },
    );
  } else {
    if (params.linkURL) {
      sep();
      items.push({ label: 'Copy link', click: () => actions.copyLink?.(params.linkURL) });
    }
    if (params.selectionText && params.selectionText.trim()) {
      sep();
      items.push({ role: 'copy', enabled: flags.canCopy !== false });
    }
  }
  return items;
}
