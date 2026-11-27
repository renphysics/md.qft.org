(function () {
  var count = 0;
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('trace');
    var output = document.getElementById('ray-count');
    if (!button || !output) return;
    button.addEventListener('click', function () {
      count += 1;
      output.textContent = String(count);
    });
  });
})();
