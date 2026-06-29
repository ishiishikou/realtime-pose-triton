from app.pose_types import WebRtcOffer


def test_webrtc_offer_model_accepts_sdp_and_type():
    offer = WebRtcOffer(sdp='v=0', type='offer')

    assert offer.sdp == 'v=0'
    assert offer.type == 'offer'
