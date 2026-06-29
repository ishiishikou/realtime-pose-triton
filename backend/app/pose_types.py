from pydantic import BaseModel


class WebRtcOffer(BaseModel):
    sdp: str
    type: str
