const angle = document.getElementById('angle');
const range = document.getElementById('range');

function update() {
  const radians = Number(angle.value) * Math.PI / 180;
  const metres = (20 * 20 * Math.sin(2 * radians)) / 9.81;
  range.textContent = metres.toFixed(1);
}

angle.addEventListener('input', update);
update();
