import pdb
from typing import Tuple
import torch
import torch.nn as nn
from transformers import PreTrainedModel
import argparse
import importlib
import json
import math
import multiprocessing as mp
import os
import time
from argparse import Namespace
from pathlib import Path

# monkey patch to fix issues in msaf
import scipy
import numpy as np

scipy.inf = np.inf

import librosa
import torch
from ema_pytorch import EMA
from loguru import logger
from muq import MuQ
from musicfm.model.musicfm_25hz import MusicFM25Hz
from omegaconf import OmegaConf
from tqdm import tqdm
import torch
import torch.nn as nn
from transformers import PreTrainedModel
from transformers.modeling_outputs import CausalLMOutputWithPast
from configuration_songformer import SongFormerConfig
from model_config import ModelConfig

from model import Model
from omegaconf import OmegaConf

# MUSICFM_HOME_PATH = os.path.join("ckpts", "MusicFM")
MUSICFM_HOME_PATH = "/home/node59_tmpdata3/cbhao/SongFormer_kaiyuan_test/github_test/SongFormer/src/SongFormer/ckpts/MusicFM"

BEFORE_DOWNSAMPLING_FRAME_RATES = 25
AFTER_DOWNSAMPLING_FRAME_RATES = 8.333

DATASET_LABEL = "SongForm-HX-8Class"
DATASET_IDS = [5]

TIME_DUR = 420
INPUT_SAMPLING_RATE = 24000

from dataset.label2id import DATASET_ID_ALLOWED_LABEL_IDS, DATASET_LABEL_TO_DATASET_ID
from postprocessing.functional import postprocess_functional_structure


def rule_post_processing(msa_list):
    if len(msa_list) <= 2:
        return msa_list

    result = msa_list.copy()

    while len(result) > 2:
        first_duration = result[1][0] - result[0][0]
        if first_duration < 1.0 and len(result) > 2:
            result[0] = (result[0][0], result[1][1])
            result = [result[0]] + result[2:]
        else:
            break

    while len(result) > 2:
        last_label_duration = result[-1][0] - result[-2][0]
        if last_label_duration < 1.0:
            result = result[:-2] + [result[-1]]
        else:
            break

    while len(result) > 2:
        if result[0][1] == result[1][1] and result[1][0] <= 10.0:
            result = [(result[0][0], result[0][1])] + result[2:]
        else:
            break

    while len(result) > 2:
        last_duration = result[-1][0] - result[-2][0]
        if result[-2][1] == result[-3][1] and last_duration <= 10.0:
            result = result[:-2] + [result[-1]]
        else:
            break

    return result


class SongFormerModel(PreTrainedModel):
    config_class = SongFormerConfig

    def __init__(self, config: SongFormerConfig):
        super().__init__(config)
        device = "cpu"
        root_dir = os.environ["SONGFORMER_LOCAL_DIR"]
        with open(os.path.join(root_dir, "muq_config2.json"), "r") as f:
            muq_config_file = OmegaConf.load(f)
        # self.muq = MuQ.from_pretrained("OpenMuQ/MuQ-large-msd-iter", device_map=None)
        self.muq = MuQ(muq_config_file)

        self.musicfm = MusicFM25Hz(
            is_flash=False,
            stat_path=os.path.join(root_dir, "msd_stats.json"),
            # model_path=os.path.join(MUSICFM_HOME_PATH, "pretrained_msd.pt"),
        )
        self.songformer = Model(ModelConfig())

        num_classes = config.num_classes
        dataset_id2label_mask = {}
        for key, allowed_ids in DATASET_ID_ALLOWED_LABEL_IDS.items():
            dataset_id2label_mask[key] = np.ones(config.num_classes, dtype=bool)
            dataset_id2label_mask[key][allowed_ids] = False

        self.num_classes = num_classes
        self.dataset_id2label_mask = dataset_id2label_mask
        self.config = config

    def forward(self, input):
        with torch.no_grad():
            INPUT_SAMPLING_RATE = 24000

            device = next(self.parameters()).device
            # 如果为tensor或者是numpy
            if isinstance(input, (torch.Tensor, np.ndarray)):
                audio = torch.tensor(input).to(device)
            elif os.path.exists(input):
                wav, sr = librosa.load(input, sr=INPUT_SAMPLING_RATE)
                audio = torch.tensor(wav).to(device)
            else:
                raise ValueError("input should be a tensor/numpy or a valid file path")

            win_size = self.config.win_size
            hop_size = self.config.hop_size
            num_classes = self.config.num_classes
            total_len = (
                (audio.shape[0] // INPUT_SAMPLING_RATE) // TIME_DUR
            ) * TIME_DUR + TIME_DUR
            total_frames = math.ceil(total_len * AFTER_DOWNSAMPLING_FRAME_RATES)

            logits = {
                "function_logits": np.zeros([total_frames, num_classes]),
                "boundary_logits": np.zeros([total_frames]),
            }
            logits_num = {
                "function_logits": np.zeros([total_frames, num_classes]),
                "boundary_logits": np.zeros([total_frames]),
            }

            lens = 0
            i = 0
            while True:
                iter_start = time.time()
                start_idx = i * INPUT_SAMPLING_RATE
                end_idx = min((i + win_size) * INPUT_SAMPLING_RATE, audio.shape[-1])
                if start_idx >= audio.shape[-1]:
                    break
                if end_idx - start_idx <= 1024:
                    continue
                audio_seg = audio[start_idx:end_idx]
                print(f"[chunk i={i}] processing {(end_idx-start_idx)/INPUT_SAMPLING_RATE:.1f}s window...")

                # MuQ embedding
                muq_output = self.muq(audio_seg.unsqueeze(0), output_hidden_states=True)
                muq_embd_420s = muq_output["hidden_states"][10]
                del muq_output
                print(f"[chunk i={i}] MuQ (full window) done at {time.time()-iter_start:.1f}s")

                # MusicFM embedding
                _, musicfm_hidden_states = self.musicfm.get_predictions(audio_seg.unsqueeze(0))
                musicfm_embd_420s = musicfm_hidden_states[10]
                del musicfm_hidden_states
                print(f"[chunk i={i}] MusicFM (full window) done at {time.time()-iter_start:.1f}s")

                wraped_muq_embd_30s = []
                wraped_musicfm_embd_30s = []

                for idx_30s in range(i, i + hop_size, 30):
                    sub_start = time.time()
                    start_idx_30s = idx_30s * INPUT_SAMPLING_RATE
                    end_idx_30s = min(
                        (idx_30s + 30) * INPUT_SAMPLING_RATE,
                        audio.shape[-1],
                        (i + hop_size) * INPUT_SAMPLING_RATE,
                    )
                    if start_idx_30s >= audio.shape[-1]:
                        break
                    if end_idx_30s - start_idx_30s <= 1024:
                        continue
                    wraped_muq_embd_30s.append(
                        self.muq(audio[start_idx_30s:end_idx_30s].unsqueeze(0), output_hidden_states=True)["hidden_states"][10]
                    )
                    wraped_musicfm_embd_30s.append(
                        self.musicfm.get_predictions(audio[start_idx_30s:end_idx_30s].unsqueeze(0))[1][10]
                    )
                    print(f"[chunk i={i}] 30s sub-window idx={idx_30s} done in {time.time()-sub_start:.1f}s")

                wraped_muq_embd_30s = torch.concatenate(wraped_muq_embd_30s, dim=1)
                wraped_musicfm_embd_30s = torch.concatenate(
                    wraped_musicfm_embd_30s, dim=1
                )
                all_embds = [
                    wraped_musicfm_embd_30s,
                    wraped_muq_embd_30s,
                    musicfm_embd_420s,
                    muq_embd_420s,
                ]

                if len(all_embds) > 1:
                    embd_lens = [x.shape[1] for x in all_embds]
                    max_embd_len = max(embd_lens)
                    min_embd_len = min(embd_lens)
                    if abs(max_embd_len - min_embd_len) > 4:
                        raise ValueError(
                            f"Embedding shapes differ too much: {max_embd_len} vs {min_embd_len}"
                        )

                    for idx in range(len(all_embds)):
                        all_embds[idx] = all_embds[idx][:, :min_embd_len, :]

                embd = torch.concatenate(all_embds, axis=-1)

                dataset_label = DATASET_LABEL
                dataset_ids = torch.Tensor(DATASET_IDS).to(device, dtype=torch.long)
                msa_info, chunk_logits = self.songformer.infer(
                    input_embeddings=embd,
                    dataset_ids=dataset_ids,
                    label_id_masks=torch.Tensor(
                        self.dataset_id2label_mask[
                            DATASET_LABEL_TO_DATASET_ID[dataset_label]
                        ]
                    )
                    .to(device, dtype=bool)
                    .unsqueeze(0)
                    .unsqueeze(0),
                    with_logits=True,
                )

                start_frame = int(i * AFTER_DOWNSAMPLING_FRAME_RATES)
                end_frame = start_frame + min(
                    math.ceil(hop_size * AFTER_DOWNSAMPLING_FRAME_RATES),
                    chunk_logits["boundary_logits"][0].shape[0],
                )

                logits["function_logits"][start_frame:end_frame, :] += (
                    chunk_logits["function_logits"][0].detach().cpu().numpy()
                )
                logits["boundary_logits"][start_frame:end_frame] = (
                    chunk_logits["boundary_logits"][0].detach().cpu().numpy()
                )
                logits_num["function_logits"][start_frame:end_frame, :] += 1
                logits_num["boundary_logits"][start_frame:end_frame] += 1
                lens += end_frame - start_frame

                i += hop_size

                print(f"[chunk i={i}] FULL outer iteration done in {time.time()-iter_start:.1f}s\n")
            logits["function_logits"] = np.divide(
                logits["function_logits"], logits_num["function_logits"],
                out=np.zeros_like(logits["function_logits"]),
                where=logits_num["function_logits"] != 0
            )
            logits["boundary_logits"] = np.divide(
                logits["boundary_logits"], logits_num["boundary_logits"],
                out=np.zeros_like(logits["boundary_logits"]),
                where=logits_num["boundary_logits"] != 0
            )

            logits["function_logits"] = torch.from_numpy(
                logits["function_logits"][:lens]
            ).unsqueeze(0)
            logits["boundary_logits"] = torch.from_numpy(
                logits["boundary_logits"][:lens]
            ).unsqueeze(0)

            msa_infer_output = postprocess_functional_structure(logits, self.config)

            assert msa_infer_output[-1][-1] == "end"
            if not self.config.no_rule_post_processing:
                msa_infer_output = rule_post_processing(msa_infer_output)
            msa_json = []
            for idx in range(len(msa_infer_output) - 1):
                msa_json.append(
                    {
                        "label": msa_infer_output[idx][1],
                        "start": msa_infer_output[idx][0],
                        "end": msa_infer_output[idx + 1][0],
                    }
                )
            return msa_json

    @staticmethod
    def _fix_state_dict_key_on_load(key: str) -> Tuple[str, bool]:
        """Replace legacy parameter names with their modern equivalents. E.g. beta -> bias, gamma -> weight."""

        # ---- begin: ignore muq ----
        if key.startswith("muq."):
            return key, False
        # ---- end ---

        # Rename LayerNorm beta & gamma params for some early models ported from Tensorflow (e.g. Bert)
        # This rename is logged.
        if key.endswith("LayerNorm.beta"):
            return key.replace("LayerNorm.beta", "LayerNorm.bias"), True
        if key.endswith("LayerNorm.gamma"):
            return key.replace("LayerNorm.gamma", "LayerNorm.weight"), True

        # Rename weight norm parametrizations to match changes across torch versions.
        # Impacts a number of speech/wav2vec models. e.g. Hubert, Wav2Vec2, and others.
        # This rename is not logged.
        if hasattr(nn.utils.parametrizations, "weight_norm"):
            if key.endswith("weight_g"):
                return key.replace(
                    "weight_g", "parametrizations.weight.original0"
                ), True
            if key.endswith("weight_v"):
                return key.replace(
                    "weight_v", "parametrizations.weight.original1"
                ), True
        else:
            if key.endswith("parametrizations.weight.original0"):
                return key.replace(
                    "parametrizations.weight.original0", "weight_g"
                ), True
            if key.endswith("parametrizations.weight.original1"):
                return key.replace(
                    "parametrizations.weight.original1", "weight_v"
                ), True

        return key, False
