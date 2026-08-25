from transformers import PretrainedConfig

class SongFormerConfig(PretrainedConfig):
    """Configuration class to store the configuration of a custom model."""
    
    model_type = "custom_model"
    
    def __init__(
        self,
        win_size=420,
        hop_size=420,
        num_classes=128,
        no_rule_post_processing=False,
        local_maxima_filter_size=3,
        frame_rates=8.333,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.win_size = win_size
        self.hop_size = hop_size
        self.num_classes = num_classes
        self.no_rule_post_processing = no_rule_post_processing
        self.local_maxima_filter_size = local_maxima_filter_size
        self.frame_rates = frame_rates