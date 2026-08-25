# config.py
from transformers import PretrainedConfig

class ModelConfig(PretrainedConfig):
    model_type = "SongFormer"
    
    def __init__(
        self,
        input_dim=2048,
        input_dim_raw=4096,
        transformer_encoder_input_dim=1024,
        transformer_input_dim=512,
        num_transformer_layers=4,
        transformer_nhead=8,
        transformer_dropout=0.1,
        num_classes=128,
        num_dataset_classes=64,
        down_sample_conv_kernel_size=3,
        down_sample_conv_stride=3,
        down_sample_conv_dropout=0.1,
        down_sample_conv_padding=0,
        boundary_tv_loss_beta=0.6,
        boundary_tv_loss_lambda=0.4,
        boundary_tv_loss_boundary_threshold=0.01,
        boundary_tv_loss_reduction_weight=0.1,
        boundary_tvloss_weight=0.05,
        label_focal_loss_alpha=0.25,
        label_focal_loss_gamma=2.0,
        label_focal_loss_weight=0.2,
        loss_weight_section=0.2,
        loss_weight_function=0.8,
        learn_label=True,
        learn_segment=True,
        local_maxima_filter_size=3,
        frame_rates=8.333,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.input_dim = input_dim
        self.input_dim_raw = input_dim_raw
        self.transformer_encoder_input_dim = transformer_encoder_input_dim
        self.transformer_input_dim = transformer_input_dim
        self.num_transformer_layers = num_transformer_layers
        self.transformer_nhead = transformer_nhead
        self.transformer_dropout = transformer_dropout
        self.num_classes = num_classes
        self.num_dataset_classes = num_dataset_classes
        self.down_sample_conv_kernel_size = down_sample_conv_kernel_size
        self.down_sample_conv_stride = down_sample_conv_stride
        self.down_sample_conv_dropout = down_sample_conv_dropout
        self.down_sample_conv_padding = down_sample_conv_padding
        self.boundary_tv_loss_beta = boundary_tv_loss_beta
        self.boundary_tv_loss_lambda = boundary_tv_loss_lambda
        self.boundary_tv_loss_boundary_threshold = boundary_tv_loss_boundary_threshold
        self.boundary_tv_loss_reduction_weight = boundary_tv_loss_reduction_weight
        self.boundary_tvloss_weight = boundary_tvloss_weight
        self.label_focal_loss_alpha = label_focal_loss_alpha
        self.label_focal_loss_gamma = label_focal_loss_gamma
        self.label_focal_loss_weight = label_focal_loss_weight
        self.loss_weight_section = loss_weight_section
        self.loss_weight_function = loss_weight_function
        self.learn_label = learn_label
        self.learn_segment = learn_segment
        self.local_maxima_filter_size = local_maxima_filter_size
        self.frame_rates = frame_rates