import sys, os
import torch
from transformers import AutoModel
from torch.profiler import profile, ProfilerActivity
torch.set_num_threads(os.cpu_count())
torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
INPUT_SAMPLING_RATE = 24000

sys.path.append(os.path.join(os.path.dirname(__file__), "songformer"))
os.environ["SONGFORMER_LOCAL_DIR"] = os.path.join(os.path.dirname(__file__), "songformer")

songformer = AutoModel.from_pretrained(
    os.environ["SONGFORMER_LOCAL_DIR"], trust_remote_code=True, low_cpu_mem_usage=False
)
device = "cuda:0"
songformer.to(device)
songformer.eval()

print("MuQ encoder type:", type(songformer.muq))
for name, module in songformer.muq.named_modules():
    if "encoder" in name.lower() or "conformer" in name.lower():
        print(f"  {name}: {type(module)}")

print("Warming up model (JIT compile / cuDNN autotune)...")
with torch.no_grad():
    dummy_30s = torch.zeros(1, 30 * INPUT_SAMPLING_RATE, device=device)
    songformer.muq(dummy_30s, output_hidden_states=True)
    songformer.musicfm.get_predictions(dummy_30s)
print("Warmup complete.")

print("MuQ encoder type:", type(songformer.muq))
for name, module in songformer.muq.named_modules():
    if "encoder" in name.lower() or "conformer" in name.lower():
        print(f"  {name}: {type(module)}")


with torch.no_grad(), profile(
    #activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
    activities=[ProfilerActivity.CPU, ],
    record_shapes=True,
    with_stack=False,
) as prof:
    result = songformer("C:\\Users\\no no\\Desktop\\hackaton\\newBranch\\fragments-musical-memory\\python-backend\\bonski.wav")
#result = songformer("C:\\Users\\no no\\Desktop\\hackaton\\newBranch\\fragments-musical-memory\\python-backend\\bonski.wav")

print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=25))