#!/usr/bin/env bash
set -e

CONDA_BASE=$(conda info --base 2>/dev/null) || {
    echo "ERROR: conda was not found on PATH. Please install Anaconda/Miniconda first."
    exit 1
}

# Make 'conda activate'-equivalent usable inside this non-interactive shell
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate base

cd "$(dirname "$0")"
python setup_and_run.py
