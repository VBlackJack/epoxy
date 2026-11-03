*Version française : [fr/playtest.md](./fr/playtest.md)*

# Playtest guide

Thank you for testing Epoxy. Playtest mode records, on your device only, how you play each level, so the levels can be tuned. You play normally; the game does the bookkeeping.

## 1. Turn it on

- [ ] Open the **Options** menu.
- [ ] Open the **Advanced** section.
- [ ] Press **Playtest mode**. The button lights up.
- [ ] Check that a small **Playtest** badge shows in the level panel.

The mode is off by default and stays on until you turn it off.

## 2. Play normally

- Play any level the way you would without the mode. Use the hint, the solution, undo and restart whenever you like.
- Do not hurry and do not hold back: it is the real behaviour that is useful.
- Leaving a level without solving it is fine and is worth knowing about.

## 3. Rate the level

After you solve a level, and when you leave a level you tried but did not solve, a short form appears:

| Question | Answer |
|---|---|
| Difficulty | A short scale, from too easy to too hard |
| Fun | A short scale, from boring to great |
| Did you have an aha moment? | Yes or No |
| Note | Optional, a few words |

- Every question is optional.
- **Escape**, **Skip** or a click outside the form closes it without saving a rating. The level data is kept anyway.
- The form can always be skipped, and you can keep playing as soon as you close it.

## 4. Export and send

- [ ] Open **Options**, then **Advanced**.
- [ ] Read **Recorded sessions** to see how many sessions are stored.
- [ ] Press **Export playtest data**. A file named like `epoxy-playtest-20261103-140509.json` is saved by your browser.
- [ ] Send that file to the person who asked you to test (email, chat, shared folder).

If you export in the middle of a level, the file also contains that level so far, marked `in_progress`, with the same id its final session will have. When you send several files, keep the last copy of each session id.

**Clear playtest data** deletes everything stored on your device, after a confirmation. Export first if you want to keep it.

## 5. What is recorded

For each level you play (one session per series of attempts):

- the pack and level, the ruleset and the game version;
- which play aids the level offered (hint, solution, dead-end warning);
- when you started and stopped, and your active playing time (pauses, a hidden tab and open menus are not counted);
- the number of attempts (the first try, plus one for each restart; dying and then undoing is the same attempt), restarts, undos, hints, solution views and dead-end warnings;
- each death, with its cause and the cell where it happened;
- whether you won (with your moves and time) or left, and how you left (another level, another pack, closing the tab);
- the moves of your winning attempt and of your last attempt, as a short string of directions;
- your rating and note, if you gave them.

Nothing else is recorded: no name, no account, no device information.

## 6. Privacy

**Nothing is sent automatically.** The data stays in your browser's local storage. The only way it leaves your device is the file you choose to export and to send yourself. The stored history is bounded: past a fixed number of sessions the oldest ones are dropped.
