const HIGHLIGHT_SELECTOR = '.search-highlight';

function collectSearchRoots(container: HTMLElement): Array<HTMLElement | ShadowRoot> {
  const roots: Array<HTMLElement | ShadowRoot> = [container];
  const queue: Array<HTMLElement | ShadowRoot> = [container];

  while (queue.length > 0) {
    const root = queue.shift();
    if (!root) continue;

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        queue.push(element.shadowRoot);
      }
    }
  }

  return roots;
}

function unwrapHighlights(container: HTMLElement) {
  const roots = collectSearchRoots(container);
  roots.forEach((root) => {
    const existingHighlights = root.querySelectorAll(HIGHLIGHT_SELECTOR);
    existingHighlights.forEach((element) => {
      const parent = element.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(element.textContent || ''), element);
      parent.normalize();
    });
  });
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  const tagName = parent.tagName;
  return tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'INPUT' || tagName === 'TEXTAREA';
}

function collectMatchingTextNodes(container: HTMLElement, lowerSearch: string): Text[] {
  const textNodes: Text[] = [];
  for (const root of collectSearchRoots(container)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (
        node instanceof Text &&
        node.nodeValue &&
        node.nodeValue.toLowerCase().includes(lowerSearch) &&
        !shouldSkipTextNode(node)
      ) {
        textNodes.push(node);
      }
      node = walker.nextNode();
    }
  }
  return textNodes;
}

export function countSearchMatches(container: HTMLElement | null, searchText: string): number {
  if (!container || !searchText.trim()) return 0;
  const lowerSearch = searchText.toLowerCase();
  let count = 0;
  for (const textNode of collectMatchingTextNodes(container, lowerSearch)) {
    const lower = (textNode.nodeValue || '').toLowerCase();
    let idx = lower.indexOf(lowerSearch);
    while (idx !== -1) {
      count++;
      idx = lower.indexOf(lowerSearch, idx + lowerSearch.length);
    }
  }
  return count;
}

export interface ApplySearchHighlightsResult {
  matchCount: number;
  currentElement: HTMLElement | null;
}

export function clearSearchHighlights(container: HTMLElement | null) {
  if (!container) return;
  unwrapHighlights(container);
}

export function applySearchHighlights(
  container: HTMLElement | null,
  searchText: string,
  currentMatchIndex: number | null = null
): ApplySearchHighlightsResult {
  if (!container) {
    return { matchCount: 0, currentElement: null };
  }

  unwrapHighlights(container);

  if (!searchText.trim()) {
    return { matchCount: 0, currentElement: null };
  }

  const lowerSearch = searchText.toLowerCase();
  const textNodes = collectMatchingTextNodes(container, lowerSearch);

  let matchCounter = 0;
  let currentElement: HTMLElement | null = null;

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || '';
    const lowerText = text.toLowerCase();
    let lastIndex = 0;
    let searchIndex = lowerText.indexOf(lowerSearch, lastIndex);
    if (searchIndex === -1) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    while (searchIndex !== -1) {
      if (searchIndex > lastIndex) {
        parent.insertBefore(document.createTextNode(text.slice(lastIndex, searchIndex)), textNode);
      }

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(searchIndex, searchIndex + searchText.length);

      if (currentMatchIndex !== null && matchCounter === currentMatchIndex) {
        mark.classList.add('search-highlight-current');
        currentElement = mark;
      }

      parent.insertBefore(mark, textNode);
      matchCounter += 1;
      lastIndex = searchIndex + searchText.length;
      searchIndex = lowerText.indexOf(lowerSearch, lastIndex);
    }

    if (lastIndex < text.length) {
      parent.insertBefore(document.createTextNode(text.slice(lastIndex)), textNode);
    }

    parent.removeChild(textNode);
  }

  return { matchCount: matchCounter, currentElement };
}
