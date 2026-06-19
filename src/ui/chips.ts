/**
 * Minimal segmented "chip" control. Renders one selectable pill per option
 * into the given host element and calls `onPick` with the chosen key.
 */
export function renderChips<K extends string>(
  hostId: string,
  options: Record<K, string>,
  activeKey: K,
  onPick: (key: K) => void,
): void {
  const host = document.getElementById(hostId);
  if (!host) throw new Error(`chips host #${hostId} not found`);
  host.innerHTML = '';

  (Object.keys(options) as K[]).forEach((key) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (key === activeKey ? ' on' : '');
    chip.textContent = options[key];
    chip.addEventListener('click', () => {
      for (const child of Array.from(host.children)) child.classList.remove('on');
      chip.classList.add('on');
      onPick(key);
    });
    host.appendChild(chip);
  });
}
