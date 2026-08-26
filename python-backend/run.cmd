@echo off
where conda >nul 2>nul
if errorlevel 1 (
    echo ERROR: conda was not found on PATH. Please install Anaconda/Miniconda first.
    exit /b 1
)

CALL conda activate base
cd /d "%~dp0"
python setup_and_run.py
