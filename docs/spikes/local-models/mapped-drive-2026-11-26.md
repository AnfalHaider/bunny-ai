# LF-14: does a mapped network drive resolve to `\server\share`? (Builder E, 2026-11-26)

**Not proven on this PC.** To map a drive I tried `net use Y: \localhost\C$`; it failed with "System error 67: The network name cannot be found" (this PC has no admin share and no file-sharing server running), and I made no share of my own (that needs administrator rights and changes the PC).

So the build does what LF-14 asks for when it is not proven: it adds the drive-type check. `localFolderRules.js` asks the main process for the drive's `[System.IO.DriveInfo]` DriveType (a read-only PowerShell call) and refuses `Network` for a model folder, a model file and the download folder, on top of refusing any real path that does not start with a drive letter (UNC, `\?\`, `\.\`). It is tested with an injected drive type (`test/local-folder-rules.test.js`: a Network drive type is refused with "Bunny only uses folders on this PC's own drives.", and a real path that comes back as `\server\share` is refused).

Still open for a PC that has a share: confirm what `fs.realpath.native` returns for a mapped drive. Either answer is covered.
