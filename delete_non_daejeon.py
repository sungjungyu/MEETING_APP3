#!/usr/bin/env python3
"""대전 서구 외 모임글/게시글 삭제 스크립트"""
import asyncio
import sys

sys.path.insert(0, '/Users/seongjungyu/Desktop/MEETING_APP3')

from sqlalchemy import select, delete, or_, and_
from sqlalchemy.orm import selectinload
from database import engine, AsyncSessionLocal
from models import Meeting, BoardPost, MeetingApplication, ChatMessage, MeetingSchedule


async def delete_non_daejeon_meetings():
    """대전 서구 외 모임글 삭제"""
    print("=" * 60)
    print("🗑️  대전광역시 서구가 아닌 모임글 삭제")
    print("=" * 60)
    
    async with AsyncSessionLocal() as session:
        # 대전 서구 모임 ID 조회
        result = await session.execute(
            select(Meeting.id).where(
                and_(
                    Meeting.location.ilike("%대전%"),
                    Meeting.location.ilike("%서구%")
                )
            )
        )
        daejeon_ids = {row[0] for row in result.all()}
        print(f"\n✓ 대전 서구 모임: {len(daejeon_ids)}개 (보존)")
        
        if not daejeon_ids:
            print("⚠️  대전 서구 모임이 없습니다. 모든 모임을 삭제하시겠습니까?")
            return
        
        # 삭제할 모임 ID 조회
        result = await session.execute(
            select(Meeting.id).where(
                ~Meeting.id.in_(daejeon_ids)
            )
        )
        delete_ids = [row[0] for row in result.all()]
        print(f"✓ 삭제할 모임: {len(delete_ids)}개")
        
        if not delete_ids:
            print("\n✅ 삭제할 모임이 없습니다.")
            return
        
        # 연관 데이터 개수 확인
        result = await session.execute(
            select(BoardPost).where(BoardPost.meeting_id.in_(delete_ids))
        )
        posts_count = len(result.scalars().all())
        
        result = await session.execute(
            select(MeetingApplication).where(MeetingApplication.meeting_id.in_(delete_ids))
        )
        applications_count = len(result.scalars().all())
        
        result = await session.execute(
            select(ChatMessage).where(ChatMessage.meeting_id.in_(delete_ids))
        )
        messages_count = len(result.scalars().all())
        
        result = await session.execute(
            select(MeetingSchedule).where(MeetingSchedule.meeting_id.in_(delete_ids))
        )
        schedules_count = len(result.scalars().all())
        
        print(f"  - 연관 게시글: {posts_count}개")
        print(f"  - 연관 신청: {applications_count}개")
        print(f"  - 연관 메시지: {messages_count}개")
        print(f"  - 연관 일정: {schedules_count}개")
        
        # CASCADE로 연관 데이터도 함께 삭제
        print(f"\n🗑️  모임 삭제 중...")
        await session.execute(
            delete(Meeting).where(Meeting.id.in_(delete_ids))
        )
        await session.commit()
        
        print(f"\n✅ {len(delete_ids)}개 모임 삭제 완료")
        print(f"   (연관 게시글, 신청, 메시지, 일정도 함께 삭제됨)")


async def show_all_meetings():
    """현재 모임 목록 출력"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Meeting).options(selectinload(Meeting.owner))
        )
        meetings = result.scalars().all()
        
        print("\n" + "=" * 60)
        print("📋 현재 모임 목록")
        print("=" * 60)
        for m in meetings:
            is_daejeon = "대전" in m.location and "서구" in m.location
            status = "✓ 대전서구" if is_daejeon else "✗ 다른지역"
            print(f"[{m.id}] {status} {m.title[:30]}...")
            print(f"     📍 {m.location}")
        print(f"\n총 {len(meetings)}개 모임")


async def main():
    # 현재 목록 출력
    await show_all_meetings()
    
    # 바로 삭제 실행
    print("\n" + "=" * 60)
    print("3초 후 대전 서구가 아닌 모임을 삭제합니다...")
    print("=" * 60)
    import asyncio
    await asyncio.sleep(3)
    
    # 삭제 실행
    await delete_non_daejeon_meetings()
    
    # 삭제 후 목록 출력
    await show_all_meetings()


if __name__ == "__main__":
    asyncio.run(main())
