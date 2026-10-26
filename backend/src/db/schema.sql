/* =====================================================================
   TaskHub — SQL Server schema
   ---------------------------------------------------------------------
   Idempotent: safe to run multiple times.
   Run with SSMS / Azure Data Studio, sqlcmd, or `npm run db:init`:

     sqlcmd -S localhost -U sa -P "YourStrong!Passw0rd" -C -i src/db/schema.sql
   ===================================================================== */

IF DB_ID(N'taskhub') IS NULL
BEGIN
    CREATE DATABASE taskhub;
END;
GO

USE taskhub;
GO

IF OBJECT_ID(N'dbo.tasks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tasks
    (
        id          UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT PK_tasks PRIMARY KEY
                        CONSTRAINT DF_tasks_id DEFAULT NEWID(),
        title       NVARCHAR(255)    NOT NULL,
        description NVARCHAR(MAX)    NOT NULL,
        completed   BIT              NOT NULL
                        CONSTRAINT DF_tasks_completed DEFAULT 0,
        created_at  DATETIME2        NOT NULL
                        CONSTRAINT DF_tasks_created_at DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2        NOT NULL
                        CONSTRAINT DF_tasks_updated_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT CK_tasks_title_not_blank CHECK (LEN(LTRIM(RTRIM(title))) > 0)
    );
END;
GO

/* Supports the default listing order (created_at DESC) and the status filter. */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_tasks_created_at'
      AND object_id = OBJECT_ID(N'dbo.tasks')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tasks_created_at
        ON dbo.tasks (created_at DESC)
        INCLUDE (completed);
END;
GO
