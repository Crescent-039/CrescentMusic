# 测试素材来源

此目录的 Moonrise.mp3、Afterglow.flac 和 cover.png，以及 ../seek-fixtures 中两段 Seek 音频，均由项目脚本生成，采用项目 MIT 许可证。

音频为数学正弦波，短音频长 3 秒，进度条测试长 185 秒；歌曲、艺人和专辑名称是测试标签。封面为程序绘制的渐变和月牙图形，未使用外部录音或封面。

重新生成需要 Python、Pillow 与支持 libmp3lame/FLAC 的 FFmpeg：

```powershell
python scripts/generate-test-fixtures.py --ffmpeg <ffmpeg可执行文件>
```

日常安装、测试和打包使用已提交的素材，无需安装这些生成工具。任务栏图标同样是项目自有程序图形，生成脚本为 scripts/generate-taskbar-icons.py。
