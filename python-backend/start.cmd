CALL conda activate backendsoundformer
set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
set HF_HUB_DISABLE_SYMLINKS=1
set KMP_DUPLICATE_LIB_OK=TRUE
set PYTHONUNBUFFERED=1
waitress-serve --host=0.0.0.0 --port=3001 --threads=1 backend:app
