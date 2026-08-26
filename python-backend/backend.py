from flask import Flask
from flask import request
from transformers import AutoModel
from huggingface_hub import snapshot_download
from flask_cors import CORS
import sys, os
import torch
from torch.profiler import profile, ProfilerActivity
torch.set_num_threads(os.cpu_count())
torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

#print("Pre-warming librosa/numba cache...")
#import librosa.core.convert    # please make it work
#import librosa.core.notation
#print("Librosa ready.")
INPUT_SAMPLING_RATE = 24000


def load_songformer_model():
    local_dir = os.path.join(os.path.dirname(__file__), "songformer")
    sys.path.append(local_dir)
    os.environ["SONGFORMER_LOCAL_DIR"] = local_dir


    songformer = AutoModel.from_pretrained(
        local_dir,
        trust_remote_code=True,
        low_cpu_mem_usage=False,
    )
    device = "cuda:0" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    songformer.to(device)
    songformer.eval()

    print("Compiling MuQ")
    #songformer.muq = torch.compile(songformer.muq) #might add this one at some point
    #print("Warming up model (JIT compile / cuDNN autotune)...")
    #with torch.no_grad():
    #    dummy_30s = torch.zeros(1, 30 * INPUT_SAMPLING_RATE, device=device)
    #    songformer.muq(dummy_30s, output_hidden_states=True)
    #    songformer.musicfm.get_predictions(dummy_30s)
    #print("Warmup complete.")
    return songformer


app = Flask(__name__)
#CORS(app, origins=["http://localhost:3000"])
CORS(app)
print("Loading model...")
model = load_songformer_model()   # runs once, at startup
print("Model ready.")

@app.route("/segment", methods=["POST"])
def segment():
    print("segmenting file")
    if "file" not in request.files:
        print("failure: no file provided")
        return {"error": "no file provided"}, 400

    print("saving file")
    audio_file = request.files["file"]
    save_path = f"{audio_file.filename}"
    audio_file.save(save_path)


    print("computing")
    #with profile(
    #    activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
    ##    record_shapes=True,
    #    profile_memory=True,
    #) as prof:
    result = model(save_path)
    print("done")
    return result


if __name__ == "__main__":
    app.run(debug=True, port=3001)
