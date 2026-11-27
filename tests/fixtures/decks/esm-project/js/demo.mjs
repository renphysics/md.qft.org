export function startCounter(root) {
  const button = root.getElementById('add');
  const output = root.getElementById('clicks');
  let clicks = 0;
  button.addEventListener('click', () => {
    clicks += 1;
    output.textContent = String(clicks);
  });
}
