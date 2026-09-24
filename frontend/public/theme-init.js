;(function () {
  var theme = 'system'
  try {
    theme = localStorage.getItem('jobtracker-theme') || 'system'
  } catch {}
  var dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
})()
