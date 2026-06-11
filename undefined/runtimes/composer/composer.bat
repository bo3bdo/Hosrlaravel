@echo off
setlocal
set "LARABOXS_RUNTIME_HOME=%~dp0..\.."
set "LARABOXS_PHP="
for /f "delims=" %%P in ('dir /b /ad "%LARABOXS_RUNTIME_HOME%\runtimes\php" 2^>nul ^| sort /r') do (
  if exist "%LARABOXS_RUNTIME_HOME%\runtimes\php\%%P\php.exe" (
    set "LARABOXS_PHP=%LARABOXS_RUNTIME_HOME%\runtimes\php\%%P\php.exe"
    goto laraboxs_php_found
  )
)
:laraboxs_php_found
if not defined LARABOXS_PHP set "LARABOXS_PHP=php"
"%LARABOXS_PHP%" "%~dp0composer.phar" %*
exit /b %ERRORLEVEL%
