# Bunny real-model test: 6 prompts

**For each prompt:**
1. Start a **new chat** in your Bunny, in Auto mode, with your usual model.
2. Paste the prompt.
3. Let Bunny finish. Answer any card the way you normally would.
4. Click **Export** at the top of the chat and save the file in **C:\Work\bunny-qa-test\transcripts**. The folder is already there.

Prompts 1–4 go in ordinary chats. Prompts 5 and 6 go in **Code** chats with the folder **C:\Work\bunny-qa-test**: choose it with "No folder" under the message box.

---

**1. Research**

```
Research question: what are the main differences between SQLite's WAL mode and the default rollback journal mode? Use the web if you can. Write a short report (about 150 words) as your answer, then list your sources.
```

**2. Numbers and a Word file**

```
Here is a small sales table: Mon 120, Tue 90, Wed 150, Thu 70, Fri 200. Work out the total, the average, the best and worst day, and the percentage each day contributes. Then make a Word document (.docx) with this table and a one-paragraph summary, and tell me where you saved it.
```

**3. A planned multi-step job**

```
Plan and carry out a three-step job: (1) pick three well-known sorting algorithms and state the worst-case time of each, (2) write a tiny comparison table, (3) say which you would use for 10 million nearly-sorted numbers and why. Show each step as you finish it.
```

**4. Recovering from a failed step**

```
First, open the file C:\Work\bunny-qa-test\does-not-exist.csv and tell me the sum of its second column. If you cannot read it, work out why, try another way to get the answer, and say plainly what you did and what you could not do.
```

**5. Code chat: build and test**

```
In this folder, create a small Python module stats.py with functions mean, median and mode, plus a test file using pytest that covers normal input, an empty list and ties for the mode. Run the tests and keep fixing until they all pass. Then tell me what you did.
```

**6. Code chat: a vague request** (in the same folder, after prompt 5)

```
Make my project better.
```

---

When all six are exported, tell the Chief of Staff "transcripts are in". QA reads only the files in that transcripts folder, and quotes only from them.
