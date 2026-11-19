# copies runs/*/SUMMARY.txt into evidence/, replacing the spike folder and the home path with placeholders
import glob, os, re, sys
root = sys.argv[1]
for d in glob.glob(os.path.join(root, 'runs', '*')):
    s = open(os.path.join(d, 'SUMMARY.txt'), encoding='utf8', newline='').read()
    s = s.replace(root, '<SPIKE>').replace(root.replace('/', chr(92)), '<SPIKE>')
    s = re.sub(r'[A-Za-z]:[\/]+Users[\/]+[^\/ "]+', '<HOME>', s)
    open(os.path.join('evidence', os.path.basename(d) + '.txt'), 'w', encoding='utf8', newline='').write(s)
