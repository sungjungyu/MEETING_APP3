from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class InterestOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=2, max_length=80)
    bio: str | None = None
    interests: list[dict] = []  # 프론트엔드에서 {name: "..."} 형식으로 보냄


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    bio: str | None
    interests: list[InterestOut] = []

    model_config = {"from_attributes": True}


class MeetingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, min_length=5)
    category: str | None = Field(default=None, min_length=2, max_length=50)
    location: str | None = Field(default=None, min_length=2, max_length=120)
    max_members: int | None = Field(default=None, ge=2, le=200)
    start_at: datetime | None = None
    end_at: datetime | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    bio: str | None = None
    interests: list[dict] | None = None  # 프론트엔드에서 {name: "..."} 형식으로 보냄


class MeetingCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=5)
    category: str = Field(min_length=2, max_length=50)
    location: str = Field(min_length=2, max_length=120)
    max_members: int = Field(ge=2, le=200)
    end_at: datetime | None = None


class PlaceRecommendationRequest(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=50)
    description: str = Field(min_length=5)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    user_location: str | None = Field(default=None, max_length=80)
    user_interests: list[str] = Field(default_factory=list, max_length=10)
    limit: int = Field(default=7, ge=5, le=10)


class PlaceRecommendationOut(BaseModel):
    kakao_id: str | None = None
    place_name: str
    address: str
    latitude: float
    longitude: float
    description: str
    features: list[str] = Field(default_factory=list)


class KakaoMapConfigOut(BaseModel):
    javascript_key: str | None = None


class MeetingScheduleCreate(BaseModel):
    location: str = Field(min_length=2, max_length=120)
    scheduled_at: datetime
    activity: str = Field(min_length=2)
    capacity: int = Field(ge=1, le=200)
    settings: str | None = None


class MeetingScheduleOut(BaseModel):
    id: int
    meeting_id: int
    location: str
    scheduled_at: datetime
    activity: str
    capacity: int
    settings: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScheduleParticipantOut(BaseModel):
    user: UserOut
    created_at: datetime

    model_config = {"from_attributes": True}


class MeetingOut(BaseModel):
    id: int
    title: str
    description: str
    category: str
    location: str
    max_members: int
    start_at: datetime
    end_at: datetime | None
    owner: UserOut
    approved_members: int = 0

    model_config = {"from_attributes": True}


class ApplicationCreate(BaseModel):
    message: str | None = None


class ApplicationOut(BaseModel):
    id: int
    meeting_id: int
    user: UserOut
    status: str
    message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApplicationInboxOut(BaseModel):
    id: int
    meeting_id: int
    meeting_title: str
    user: UserOut
    status: str
    message: str | None
    created_at: datetime


class ApplicationDecision(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")


class BoardPostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    content: str | None = Field(default=None, min_length=2)


class BoardPostCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    content: str = Field(min_length=2)
    meeting_id: int | None = None


class MeetingScheduleCreate(BaseModel):
    location: str = Field(min_length=2, max_length=120)
    scheduled_at: datetime
    activity: str = Field(min_length=2)
    capacity: int = Field(ge=1, le=200)
    settings: str | None = None


class MeetingScheduleOut(BaseModel):
    id: int
    meeting_id: int
    location: str
    scheduled_at: datetime
    activity: str
    capacity: int
    settings: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BoardPostOut(BaseModel):
    id: int
    meeting_id: int | None
    meeting_title: str | None = None
    author: UserOut
    title: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class ChatMessageOut(BaseModel):
    id: int
    meeting_id: int
    sender: UserOut
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
