---
tags:
- music-structure-annotation
- transformer
---

<p align="center">
  <img src="https://github.com/ASLP-lab/SongFormer/blob/main/figs/logo.png?raw=true" width="50%" />
</p>

<h1 align="center">SongFormer: Scaling Music Structure Analysis with Heterogeneous Supervision</h1>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.10-brightgreen)
![License](https://img.shields.io/badge/License-CC%20BY%204.0-lightblue)
[![arXiv Paper](https://img.shields.io/badge/arXiv-2510.02797-blue)](https://arxiv.org/abs/2510.02797)
[![GitHub](https://img.shields.io/badge/GitHub-SongFormer-black)](https://github.com/ASLP-lab/SongFormer)
[![HuggingFace Space](https://img.shields.io/badge/HuggingFace-space-yellow)](https://huggingface.co/spaces/ASLP-lab/SongFormer)
[![HuggingFace Model](https://img.shields.io/badge/HuggingFace-model-blue)](https://huggingface.co/ASLP-lab/SongFormer)
[![Dataset SongFormDB](https://img.shields.io/badge/HF%20Dataset-SongFormDB-green)](https://huggingface.co/datasets/ASLP-lab/SongFormDB)
[![Dataset SongFormBench](https://img.shields.io/badge/HF%20Dataset-SongFormBench-orange)](https://huggingface.co/datasets/ASLP-lab/SongFormBench)
[![Discord](https://img.shields.io/badge/Discord-join%20us-purple?logo=discord&logoColor=white)](https://discord.gg/p5uBryC4Zs)
[![lab](https://img.shields.io/badge/🏫-ASLP-grey?labelColor=lightgrey)](http://www.npu-aslp.org/)

</div>

<div align="center">
  <h3>
    Chunbo Hao<sup>1*</sup>, Ruibin Yuan<sup>2,6*</sup>, Jixun Yao<sup>1</sup>, Qixin Deng<sup>3,6</sup>,<br>Xinyi Bai<sup>4,6</sup>, Yanbo Wang<sup>5</sup>, Wei Xue<sup>2</sup>, Lei Xie<sup>1†</sup>
  </h3>


  <p>
    <sup>*</sup>Equal contribution &nbsp;&nbsp; <sup>†</sup>Corresponding author
  </p>
  <p>
    <sup>1</sup>Audio, Speech and Language Processing Group (ASLP@NPU),<br>School of Computer Science, Northwestern Polytechnical University<br>
    <sup>2</sup>Hong Kong University of Science and Technology<br>
    <sup>3</sup>Northwestern University<br>
    <sup>4</sup>Cornell University<br>
    <sup>5</sup>University of New South Wales<br>
    <sup>6</sup>Multimodal Art Projection (M-A-P)
  </p>

</div>

----

SongFormer is a music structure analysis framework that leverages multi-resolution self-supervised representations and heterogeneous supervision, accompanied by the large-scale multilingual dataset SongFormDB and the high-quality benchmark SongFormBench to foster fair and reproducible research.

![](https://github.com/ASLP-lab/SongFormer/blob/main/figs/songformer.png?raw=true)

For a more detailed deployment guide, please refer to the [GitHub repository](https://github.com/ASLP-lab/SongFormer/).

## 🚀 QuickStart

### Prerequisites

Before running the model, follow the instructions in the [GitHub repository](https://github.com/ASLP-lab/SongFormer/) to set up the required **Python environment**.

---

### Input: Audio File Path

You can perform inference by providing the path to an audio file:

```python
from transformers import AutoModel
from huggingface_hub import snapshot_download
import sys
import os

# Download the model from Hugging Face Hub
local_dir = snapshot_download(
    repo_id="ASLP-lab/SongFormer",
    repo_type="model",
    local_dir_use_symlinks=False,
    resume_download=True,
    allow_patterns="*",
    ignore_patterns=["SongFormer.pt", "SongFormer.safetensors"],
)

# Add the local directory to path and set environment variable
sys.path.append(local_dir)
os.environ["SONGFORMER_LOCAL_DIR"] = local_dir

# Load the model
songformer = AutoModel.from_pretrained(
    local_dir,
    trust_remote_code=True,
    low_cpu_mem_usage=False,
)

# Set device and switch to evaluation mode
device = "cuda:0"
songformer.to(device)
songformer.eval()

# Run inference
result = songformer("path/to/audio/file.wav")
```

---

### Input: Tensor or NumPy Array

Alternatively, you can directly feed a raw audio waveform as a NumPy array or PyTorch tensor:

```python
from transformers import AutoModel
from huggingface_hub import snapshot_download
import sys
import os
import numpy as np

# Download model
local_dir = snapshot_download(
    repo_id="ASLP-lab/SongFormer",
    repo_type="model",
    local_dir_use_symlinks=False,
    resume_download=True,
    allow_patterns="*",
    ignore_patterns=["SongFormer.pt", "SongFormer.safetensors"],
)

# Setup environment
sys.path.append(local_dir)
os.environ["SONGFORMER_LOCAL_DIR"] = local_dir

# Load model
songformer = AutoModel.from_pretrained(
    local_dir,
    trust_remote_code=True,
    low_cpu_mem_usage=False,
)

# Configure device
device = "cuda:0"
songformer.to(device)
songformer.eval()

# Generate dummy audio input (sampling rate: 24,000 Hz, e.g., 60 seconds of audio)
audio = np.random.randn(24000 * 60).astype(np.float32)

# Perform inference
result = songformer(audio)
```

> ⚠️ **Note:** The expected sampling rate for input audio is **24,000 Hz**.

---

### Output Format

The model returns a structured list of segment predictions, with each entry containing timing and label information:

```json
[
  {
    "start": 0.0,          // Start time of segment (in seconds)
    "end": 15.2,           // End time of segment (in seconds)
    "label": "verse"       // Predicted segment label
  },
  ...
]
```

## 🔧 Notes

- The initialization logic of **MusicFM** has been modified to eliminate the need for loading checkpoint files during instantiation, improving both reliability and startup efficiency.

## 📚 Citation

If you use **SongFormer** in your research or application, please cite our work:

```bibtex
@misc{hao2026songformerscalingmusicstructure,
      title={SongFormer: Scaling Music Structure Analysis with Heterogeneous Supervision}, 
      author={Chunbo Hao and Ruibin Yuan and Jixun Yao and Qixin Deng and Xinyi Bai and Yanbo Wang and Wei Xue and Lei Xie},
      year={2026},
      eprint={2510.02797},
      archivePrefix={arXiv},
      primaryClass={eess.AS},
      url={https://arxiv.org/abs/2510.02797}, 
}
```