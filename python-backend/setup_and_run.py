#!/usr/bin/env python3
"""
Cross-platform setup + launch script for the SongFormer backend.
 
Requires only: Anaconda or Miniconda installed and available on PATH.
Works on Windows, Linux, and macOS (Apple Silicon and Intel).
 
Behavior:
  - If the 'backendsoundformer' conda env already exists, skips straight
    to (re)downloading the model if needed, then starts the server.
  - Otherwise: creates the env, installs requirementsNoTorch.txt, installs
    the best available torch build for this machine (CUDA / MPS / CPU),
    downloads the SongFormer model files, then starts the server.
 
Usage: don't call this directly on most platforms — use run.sh (macOS/Linux)
or run.cmd (Windows), which handle getting conda's Python on PATH first.
"""
import os
import platform
import shutil
import subprocess
 
ENV_NAME = "backendsoundformer"
PYTHON_VERSION = "3.10"
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "songformer")
REQUIREMENTS_FILE = os.path.join(HERE, "requirementsNoTorch.txt")
 
 
def run(cmd, **kwargs):
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)
 
 
def run_in_env(cmd):
    """Run a command inside the target conda env without needing
    'conda activate' (and its platform-specific CALL/source quirks)."""
    run(["conda", "run", "-n", ENV_NAME, "--no-capture-output"] + cmd)
 
 
def conda_env_exists(name):
    result = subprocess.run(
        ["conda", "env", "list"], capture_output=True, text=True, check=True
    )
    return any(
        line.split()[0] == name
        for line in result.stdout.splitlines()
        if line and not line.startswith("#")
    )
 
 
def create_env():
    print(f"Creating conda environment '{ENV_NAME}'...")
    run(["conda", "create", "-n", ENV_NAME, f"python={PYTHON_VERSION}", "-y"])
 
 
def install_base_requirements():
    print("Installing base requirements (excluding torch)...")
    run_in_env(["pip", "install", "-r", REQUIREMENTS_FILE])
 
 
def detect_nvidia_gpu():
    """True if nvidia-smi exists and successfully reports a GPU."""
    if shutil.which("nvidia-smi") is None:
        return False
    try:
        subprocess.run(["nvidia-smi"], capture_output=True, check=True, text=True)
        return True
    except subprocess.CalledProcessError:
        return False
 
 
def install_torch():
    system = platform.system()
 
    if system == "Darwin":
        # macOS: the default PyPI wheel already includes MPS acceleration
        # for Apple Silicon. There's no separate CUDA/CPU index to pick.
        print("macOS detected -> installing default torch (MPS-capable on Apple Silicon).")
        run_in_env(["pip", "install", "torch", "torchvision", "torchaudio"])
        return
 
    if detect_nvidia_gpu():
        # Try newest-to-oldest CUDA builds. Newer builds drop support for
        # older GPU architectures (e.g. cu128 dropped Maxwell/Pascal), so
        # installing one isn't enough -- we verify it actually WORKS on
        # this specific card before accepting it, since torch can install
        # cleanly yet still fail at runtime with "no kernel image is
        # available for execution on the device" on unsupported hardware.
        for index_url in [
            "https://download.pytorch.org/whl/cu128",
            "https://download.pytorch.org/whl/cu121",
        ]:
            print(f"NVIDIA GPU detected -> trying torch from {index_url}")
            try:
                run_in_env([
                    "pip", "install", "torch", "torchvision", "torchaudio",
                    "--index-url", index_url,
                ])
            except subprocess.CalledProcessError:
                print(f"Install from {index_url} failed, trying next option.")
                continue
 
            if gpu_actually_works():
                print("Confirmed: this torch build works on your GPU.")
                return
            print("Torch installed but can't run on this GPU (likely an "
                  "older architecture unsupported by this build) -> trying an older CUDA build.")
 
        print("No working CUDA build found for this GPU -> falling back to CPU-only torch.")
 
    print("Installing CPU-only torch.")
    run_in_env([
        "pip", "install", "torch", "torchvision", "torchaudio",
        "--index-url", "https://download.pytorch.org/whl/cpu",
    ])
 
 
def gpu_actually_works():
    """Installing a CUDA torch build doesn't guarantee it runs on this
    specific GPU -- newer builds drop older architectures. Actually try
    a tiny GPU op rather than trusting torch.cuda.is_available() alone."""
    test_script = (
        "import torch, sys; "
        "sys.exit(0) if torch.cuda.is_available() "
        "and (torch.zeros(1, device='cuda') + 1).item() == 1.0 else sys.exit(1)"
    )
    try:
        run_in_env(["python", "-c", test_script])
        return True
    except subprocess.CalledProcessError:
        return False
 
 
def download_model():
    # We ship modeling_songformer.py and the rest of the model code
    # ourselves (with our own local fixes) alongside this script -- only
    # the weights file itself needs to come from the Hub. Using
    # snapshot_download(allow_patterns='*') here would be wrong: it pulls
    # every file in the repo, silently overwriting our modified code with
    # the unmodified originals.
    weights_filename = "model.safetensors"
    weights_path = os.path.join(MODEL_DIR, weights_filename)
 
    if os.path.isfile(weights_path):
        print(f"Model weights already present at {weights_path}, skipping download.")
        return
 
    print(f"Downloading {weights_filename} (this may take a while)...")
    os.makedirs(MODEL_DIR, exist_ok=True)
    download_script = (
        "from huggingface_hub import hf_hub_download; "
        "hf_hub_download("
        "repo_id='ASLP-lab/SongFormer', "
        "repo_type='model', "
        f"filename='{weights_filename}', "
        f"local_dir=r'{MODEL_DIR}', "
        "local_dir_use_symlinks=False)"
    )
    run_in_env(["python", "-c", download_script])
 
 
def start_server():
    print("Starting server on http://0.0.0.0:3001 ...")
    env = os.environ.copy()
    env["HF_HUB_DISABLE_SYMLINKS"] = "1"
    env["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    env["PYTHONUNBUFFERED"] = "1"
 
    subprocess.run(
        [
            "conda", "run", "-n", ENV_NAME, "--no-capture-output",
            "waitress-serve", "--host=0.0.0.0", "--port=3001",
            "--threads=1", "backend:app",
        ],
        cwd=HERE,
        env=env,
        check=True,
    )
 
 
def main():
    if conda_env_exists(ENV_NAME):
        print(f"Environment '{ENV_NAME}' already exists — skipping setup.")
    else:
        create_env()
        install_base_requirements()
        install_torch()
 
    download_model()
    start_server()
 
 
if __name__ == "__main__":
    main()
