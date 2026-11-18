# release-0.1.13 (Security): the candidate 43ced06 against what Security signed

How it was checked:

    git merge-base --is-ancestor <signed sha> 43ced06
    git show <sha> | git patch-id --stable

| Piece | Signed at | In 43ced06 as | How |
|---|---|---|---|
| DEVICE-FULL (server, R-DF1/2/3, log fix, screens, notice) | f7caeb4 | f7caeb4 | ancestor (the same commits) |
| REMOTE-STAY (808bad5, 6c1a901, RS4 fixes) | 0fc5f75 | 0fc5f75 | ancestor |
| FONTS | 9dcf0a0 | de6a8cd | patch-id eb8eb22a861e on both |
| THEME-APPLY | 35fdb6a | 1b43ec2 | patch-ids differ (83c4fc624a84 / 4a6eb90f33fc). The diff of the two patches differs only in index lines, hunk offsets and one context line, `renderSidebar(); // "Label chats by status"…`, which comes from 911ec51 (read). No added or removed line differs. |
| Quick ask Esc | cc2bc3e | cc2bc3e | ancestor |
| Quick ask theme and fonts | 43ced06 | 43ced06 | the candidate itself |
| CHAT-SWITCH | (not signed before) 2fb688a | 7caec59 | patch-id ecf9e3922d8d on both; read here |
