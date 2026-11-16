const n = Number(process.argv[2]);
const line = 'a'.repeat(n) + '!';
const re = new RegExp('(a+)+$', 'i'); const s = Date.now(); re.test(line); console.log(n, 'a chars:', Date.now() - s, 'ms');
