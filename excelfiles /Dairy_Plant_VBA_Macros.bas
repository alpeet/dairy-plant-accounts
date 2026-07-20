Attribute VB_Name = "DairyPlantMacros"
'======================================================================
'  Dairy Plant Accounts — VBA Macros Module
'  ==========================================
'  Purpose:  PDF export, dashboard refresh, form clearing, backup
'  Compat:   Windows 7+ / Office 2007+ (NOT compatible with macOS Excel)
'  Import:   Alt+F11 > File > Import File > Select this .bas file
'
'  HOW TO ADD BUTTONS:
'  1. Developer tab > Insert > Button (Form Control)
'  2. Assign macro from the list below
'  3. Place on Dashboard or relevant sheets
'======================================================================

Option Explicit

'======================================================================
' MACRO 1: Refresh All Dashboard KPIs & Formulas
'======================================================================
Public Sub RefreshDashboard()
    ' Forces a full recalculation of all workbook formulas
    ' and refreshes all PivotTables (if any).
    
    Dim ws As Worksheet
    Dim pt As PivotTable
    
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    Application.Calculation = xlCalculationManual
    
    ' Calculate all open workbooks
    Calculate
    
    ' Refresh any PivotTables
    For Each ws In ThisWorkbook.Worksheets
        For Each pt In ws.PivotTables
            pt.RefreshTable
        Next pt
    Next ws
    
    ' Switch back to automatic calculation
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    
    ' Show user it's done
    MsgBox "Dashboard refreshed successfully!" & vbCrLf & _
           "All formulas recalculated.", _
           vbInformation, "Dashboard Refresh"
End Sub

'======================================================================
' MACRO 2: Save Current Invoice as PDF
'======================================================================
Public Sub SaveInvoiceAsPDF()
    ' Exports the Printable_Invoice sheet as a PDF file.
    ' Prompts user for save location and filename.
    
    Dim ws As Worksheet
    Dim savePath As String
    Dim defaultName As String
    Dim invoiceNo As String
    
    ' Get invoice number from sheet if possible
    On Error Resume Next
    invoiceNo = ThisWorkbook.Sheets("Printable_Invoice").Range("B8").Value
    If invoiceNo = "" Or IsError(invoiceNo) Then
        invoiceNo = "Invoice"
    End If
    On Error GoTo 0
    
    ' Clean invoice number for filename
    invoiceNo = Replace(invoiceNo, "/", "-")
    invoiceNo = Replace(invoiceNo, "\", "-")
    invoiceNo = Replace(invoiceNo, ":", "-")
    
    ' Set default filename
    defaultName = invoiceNo & "_" & Format(Date, "DD-MMM-YYYY") & ".pdf"
    
    ' Show save dialog
    savePath = Application.GetSaveAsFilename( _
        InitialFileName:=defaultName, _
        FileFilter:="PDF Files (*.pdf), *.pdf", _
        Title:="Save Invoice as PDF")
    
    If savePath = "False" Then Exit Sub  ' User cancelled
    
    ' Set references
    Set ws = ThisWorkbook.Sheets("Printable_Invoice")
    
    ' Export to PDF
    Application.ScreenUpdating = False
    
    With ws.PageSetup
        .Orientation = xlPortrait
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = 0
        .PaperSize = xlPaperA4
        .LeftMargin = Application.InchesToPoints(0.5)
        .RightMargin = Application.InchesToPoints(0.5)
        .TopMargin = Application.InchesToPoints(0.5)
        .BottomMargin = Application.InchesToPoints(0.5)
    End With
    
    ws.ExportAsFixedFormat _
        Type:=xlTypePDF, _
        Filename:=savePath, _
        Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, _
        OpenAfterPublish:=True
    
    Application.ScreenUpdating = True
    
    MsgBox "Invoice saved as PDF:" & vbCrLf & savePath, _
           vbInformation, "PDF Saved Successfully"
End Sub

'======================================================================
' MACRO 3: Save Ledger Statement as PDF
'======================================================================
Public Sub SaveLedgerAsPDF()
    ' Exports the Printable_Ledger sheet as a PDF file.
    
    Dim ws As Worksheet
    Dim savePath As String
    Dim partyName As String
    
    ' Get party name
    On Error Resume Next
    partyName = ThisWorkbook.Sheets("Printable_Ledger").Range("B6").Value
    If partyName = "" Or IsError(partyName) Then
        partyName = "Party"
    End If
    On Error GoTo 0
    
    partyName = Replace(partyName, "/", "-")
    partyName = Replace(partyName, "\", "-")
    
    savePath = Application.GetSaveAsFilename( _
        InitialFileName:=partyName & "_Ledger_" & Format(Date, "DD-MMM-YYYY") & ".pdf", _
        FileFilter:="PDF Files (*.pdf), *.pdf", _
        Title:="Save Ledger Statement as PDF")
    
    If savePath = "False" Then Exit Sub
    
    Set ws = ThisWorkbook.Sheets("Printable_Ledger")
    
    Application.ScreenUpdating = False
    
    With ws.PageSetup
        .Orientation = xlPortrait
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = 0
        .PaperSize = xlPaperA4
    End With
    
    ws.ExportAsFixedFormat _
        Type:=xlTypePDF, _
        Filename:=savePath, _
        Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, _
        OpenAfterPublish:=True
    
    Application.ScreenUpdating = True
    
    MsgBox "Ledger statement saved as PDF:" & vbCrLf & savePath, _
           vbInformation, "PDF Saved Successfully"
End Sub

'======================================================================
' MACRO 4: Clear Entry Form (for data entry sheets)
'======================================================================
Public Sub ClearEntryForm()
    ' Clears data entry range in the active sheet
    ' (rows 2-500, leaving headers and formulas intact)
    
    Dim ws As Worksheet
    Dim response As VbMsgBoxResult
    Dim dataRng As Range
    
    Set ws = ActiveSheet
    
    ' Confirm
    response = MsgBox("Clear all data entries in '" & ws.Name & "'?" & vbCrLf & _
                      "This will remove data but keep formulas and headers.", _
                      vbYesNo + vbQuestion, "Confirm Clear")
    
    If response = vbNo Then Exit Sub
    
    ' Determine which columns to clear based on sheet name
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    
    Select Case ws.Name
        Case "Sales_Entry"
            ' Clear all except formula columns (G = Amount, I = Net Amount)
            Set dataRng = ws.Range("A2:F5000, H2:H5000, J2:L5000")
            
        Case "Purchase_Entry"
            ' Clear all except formula columns (G = Amount, I = Net Amount)
            Set dataRng = ws.Range("A2:F5000, H2:H5000, J2:L5000")
            
        Case "Party_Ledger"
            ' Clear all except Balance (H) which has formulas
            Set dataRng = ws.Range("A2:G5000, I2:I5000")
            
        Case "Stock_Master"
            ' Clear input columns only (A, B, C, G, H — keep formulas in D, E, F, I, J)
            Set dataRng = ws.Range("A2:C5000, G2:H5000")
            
        Case "Party_Master"
            ' Clear input columns (keep F, G, H, I which have formulas)
            Set dataRng = ws.Range("A2:E5000")
            
        Case Else
            ' Default: clear all data
            Set dataRng = ws.Range("A2:L5000")
    End Select
    
    ' Clear contents (not formats)
    dataRng.ClearContents
    
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    
    MsgBox "Entry form cleared for '" & ws.Name & "'.", _
           vbInformation, "Clear Complete"
End Sub

'======================================================================
' MACRO 5: Generate Sales Report (PDF)
'======================================================================
Public Sub PrintSalesReport()
    ' Exports the Sales_Report sheet as PDF with current filters applied
    
    Dim savePath As String
    
    savePath = Application.GetSaveAsFilename( _
        InitialFileName:="Sales_Report_" & Format(Date, "DD-MMM-YYYY") & ".pdf", _
        FileFilter:="PDF Files (*.pdf), *.pdf", _
        Title:="Save Sales Report as PDF")
    
    If savePath = "False" Then Exit Sub
    
    Application.ScreenUpdating = False
    
    With ThisWorkbook.Sheets("Sales_Report").PageSetup
        .Orientation = xlLandscape
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = 0
        .PaperSize = xlPaperA4
    End With
    
    ThisWorkbook.Sheets("Sales_Report").ExportAsFixedFormat _
        Type:=xlTypePDF, _
        Filename:=savePath, _
        Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, _
        OpenAfterPublish:=True
    
    Application.ScreenUpdating = True
End Sub

'======================================================================
' MACRO 6: Print Purchase Report as PDF
'======================================================================
Public Sub PrintPurchaseReport()
    Dim savePath As String
    
    savePath = Application.GetSaveAsFilename( _
        InitialFileName:="Purchase_Report_" & Format(Date, "DD-MMM-YYYY") & ".pdf", _
        FileFilter:="PDF Files (*.pdf), *.pdf", _
        Title:="Save Purchase Report as PDF")
    
    If savePath = "False" Then Exit Sub
    
    Application.ScreenUpdating = False
    
    With ThisWorkbook.Sheets("Purchase_Report").PageSetup
        .Orientation = xlLandscape
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = 0
    End With
    
    ThisWorkbook.Sheets("Purchase_Report").ExportAsFixedFormat _
        Type:=xlTypePDF, _
        Filename:=savePath, _
        Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, _
        OpenAfterPublish:=True
    
    Application.ScreenUpdating = True
End Sub

'======================================================================
' MACRO 7: Create Backup Copy of Workbook
'======================================================================
Public Sub CreateBackup()
    ' Creates a timestamped backup copy of the current workbook
    
    Dim backupPath As String
    Dim baseName As String
    Dim timestamp As String
    
    ' Create backup filename with timestamp
    baseName = Left(ThisWorkbook.Name, InStrRev(ThisWorkbook.Name, ".") - 1)
    timestamp = Format(Now, "YYYY-MM-DD_HHMM")
    backupPath = ThisWorkbook.Path & "\" & baseName & "_Backup_" & timestamp & ".xlsm"
    
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    
    ' Save a copy
    ThisWorkbook.SaveCopyAs backupPath
    
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    
    MsgBox "Backup created successfully!" & vbCrLf & _
           "Location: " & backupPath, _
           vbInformation, "Backup Complete"
End Sub

'======================================================================
' MACRO 8: Go To Sheet (Navigation Helper)
'======================================================================
Public Sub GoToSheet(sheetName As String)
    ' Navigates to the specified sheet
    ' Usage: Call from any button: GoToSheet "Dashboard"
    On Error Resume Next
    ThisWorkbook.Sheets(sheetName).Activate
    If Err.Number <> 0 Then
        MsgBox "Sheet '" & sheetName & "' not found!", vbExclamation, "Navigation Error"
    End If
    On Error GoTo 0
End Sub

' ── Convenience navigation macros ──────────────────────────────────
Public Sub GoToDashboard():       GoToSheet "Dashboard": End Sub
Public Sub GoToSalesEntry():      GoToSheet "Sales_Entry": End Sub
Public Sub GoToPurchaseEntry():   GoToSheet "Purchase_Entry": End Sub
Public Sub GoToStockMaster():     GoToSheet "Stock_Master": End Sub
Public Sub GoToPartyMaster():     GoToSheet "Party_Master": End Sub
Public Sub GoToPartyLedger():     GoToSheet "Party_Ledger": End Sub
Public Sub GoToSalesReport():     GoToSheet "Sales_Report": End Sub
Public Sub GoToPurchaseReport():  GoToSheet "Purchase_Report": End Sub
Public Sub GoToStockReport():     GoToSheet "Stock_Report": End Sub
Public Sub GoToInvoice():         GoToSheet "Printable_Invoice": End Sub
Public Sub GoToLedger():          GoToSheet "Printable_Ledger": End Sub
Public Sub GoToSettings():        GoToSheet "Settings": End Sub

'======================================================================
' MACRO 9: Auto-Fit All Column Widths
'======================================================================
Public Sub AutoFitAllColumns()
    ' Auto-fits column widths on the active sheet
    Dim ws As Worksheet
    Set ws = ActiveSheet
    ws.Cells.EntireColumn.AutoFit
    MsgBox "Columns auto-fitted on '" & ws.Name & "'.", vbInformation, "AutoFit Complete"
End Sub

'======================================================================
' MACRO 10: Export All Reports to PDF (Batch)
'======================================================================
Public Sub ExportAllReportsToPDF()
    ' Exports all report sheets to a single PDF or separate PDFs
    Dim saveFolder As String
    Dim reportSheets As Variant
    Dim i As Integer
    Dim ws As Worksheet
    
    reportSheets = Array("Sales_Report", "Purchase_Report", "Stock_Report")
    
    ' Ask for folder
    With Application.FileDialog(msoFileDialogFolderPicker)
        .Title = "Select folder to save PDF reports"
        If .Show = -1 Then
            saveFolder = .SelectedItems(1)
        Else
            Exit Sub
        End If
    End With
    
    If Right(saveFolder, 1) <> "\" Then saveFolder = saveFolder & "\"
    
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    
    For i = LBound(reportSheets) To UBound(reportSheets)
        Set ws = ThisWorkbook.Sheets(reportSheets(i))
        
        With ws.PageSetup
            .Orientation = xlLandscape
            .Zoom = False
            .FitToPagesWide = 1
            .FitToPagesTall = 0
        End With
        
        ws.ExportAsFixedFormat _
            Type:=xlTypePDF, _
            Filename:=saveFolder & reportSheets(i) & "_" & Format(Date, "DD-MMM-YYYY") & ".pdf", _
            Quality:=xlQualityStandard, _
            IncludeDocProperties:=True, _
            IgnorePrintAreas:=False, _
            OpenAfterPublish:=False
    Next i
    
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    
    MsgBox "All reports exported to:" & vbCrLf & saveFolder, _
           vbInformation, "Batch Export Complete"
End Sub

'======================================================================
' MACRO 11: Print All Sheets (Quick Print)
'======================================================================
Public Sub QuickPrintSheet()
    ' Prints the active sheet with default settings
    ActiveSheet.PrintOut Copies:=1, Collate:=True, _
        ActivePrinter:=Application.ActivePrinter
End Sub

'======================================================================
' MACRO 12: Toggle Manual/Auto Calculation
'======================================================================
Public Sub ToggleCalculation()
    ' Toggles between manual and automatic calculation modes
    If Application.Calculation = xlCalculationManual Then
        Application.Calculation = xlCalculationAutomatic
        MsgBox "Calculation set to AUTOMATIC. Formulas will update automatically.", _
               vbInformation, "Calculation: Auto"
    Else
        Application.Calculation = xlCalculationManual
        MsgBox "Calculation set to MANUAL. Press F9 to recalculate all formulas.", _
               vbInformation, "Calculation: Manual"
    End If
End Sub

'======================================================================
' Auto-Run: Set calculation to auto when workbook opens
'======================================================================
Private Sub Workbook_Open()
    Application.Calculation = xlCalculationAutomatic
End Sub

'======================================================================
'  END OF MACROS
'======================================================================
