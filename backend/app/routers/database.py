from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user_email

router = APIRouter(
    prefix="/database", tags=["database"], dependencies=[Depends(get_current_user_email)]
)

@router.get("/dump")
def dump_database(db: Session = Depends(get_db)):
    # Get all table names
    tables_result = db.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).all()
    tables = [row[0] for row in tables_result]
    
    result = []
    for table in tables:
        # Get column names using PRAGMA table_info
        cols_result = db.execute(text(f"PRAGMA table_info({table})")).all()
        columns = [row[1] for row in cols_result]
        
        # Get all rows
        query = f"SELECT * FROM {table}"
        if "date" in columns:
            query += " WHERE date >= date('now', '-365 days') ORDER BY date DESC"
            
        rows_result = db.execute(text(query)).all()
        
        rows = []
        for row in rows_result:
            rows.append(dict(zip(columns, row)))
            
        result.append({
            "name": table,
            "columns": columns,
            "rows": rows
        })
        
    return result
