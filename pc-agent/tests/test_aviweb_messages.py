"""Offline only: no requests and no real AviWeb submission."""
import sys
import threading
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tool'))
import aviweb_messages as bridge
from aviweb_sender import AviWebSender, AviWebSendError

NOW = datetime(2026, 11, 25, 9, 15, tzinfo=timezone.utc)
TARGET = {'callsign':'VJC874','dep':'VVDN','arr':'RKSI','dof':'261125','reg':'VN-A523','std':'2026-11-25T09:00:00Z'}
DLA = '(DLA-VJC874-VVDN0928-RKSI-DOF/261125)'
CHG = '(CHG-VJC874-VVDN0928-RKSI-DOF/261125\r\n-9/A21N/M\r\n-10/SDGHIRWYZ/LB1\r\n-13/VVDN0928\r\n-18/PBN/A1B1 DOF/261125 REG/VNA523 OPR/VIETJET AIR)'

class Messages(unittest.TestCase):
    def test_dla_exact_content(self):
        self.assertEqual(bridge.validate_content('DLA', DLA, [TARGET], NOW), DLA+'\r\n')
    def test_chg_exact_content_preserves_multiword(self):
        self.assertEqual(bridge.validate_content('CHG', CHG, [TARGET], NOW), CHG+'\r\n')
    def test_reordered_batch(self):
        second = {**TARGET,'callsign':'VJC875'}
        value = DLA.replace('874','875')+'\r\n'+DLA
        self.assertTrue(bridge.validate_content('DLA',value,[TARGET,second],NOW).startswith('(DLA-VJC875'))
    def test_no_extra_or_missing_callsigns(self):
        for content, expected in [(DLA,[TARGET,{**TARGET,'callsign':'VJC875'}]),(DLA+'\n'+DLA,[TARGET])]:
            with self.subTest(content=content):
                with self.assertRaises(AviWebSendError): bridge.validate_content('DLA',content,expected,NOW)
    def test_wrong_route_and_dof(self):
        for value in [DLA.replace('RKSI','VVTS'), DLA.replace('261125','261124')]:
            with self.assertRaises(AviWebSendError): bridge.validate_content('DLA',value,[TARGET],NOW)
    def test_time_validation(self):
        for clock in ['2400','1260','123','ABCD']:
            with self.assertRaises(AviWebSendError): bridge.validate_content('DLA',DLA.replace('0928',clock),[TARGET],NOW)
    def test_chg_13_same_as_header(self):
        with self.assertRaises(AviWebSendError): bridge.validate_content('CHG',CHG.replace('-13/VVDN0928','-13/VVDN1028'),[TARGET],NOW)
    def test_chg_15_and_16_never_sent(self):
        for field in ['15/N0450F350 DCT','16/RKSS0430']:
            with self.assertRaises(AviWebSendError): bridge.validate_content('CHG',CHG.replace('-18/','-'+field+'\r\n-18/'),[TARGET],NOW)
    def test_reg_and_dof_locked(self):
        for value in [CHG.replace('VNA523','VNA999'), CHG.replace(' DOF/261125',''), CHG.replace(' DOF/261125',' DOF/261124')]:
            with self.assertRaises(AviWebSendError): bridge.validate_content('CHG',value,[TARGET],NOW)
    def test_operational_limits(self):
        for dt in [NOW-timedelta(hours=6,seconds=1), NOW+timedelta(hours=24,seconds=1)]:
            with self.assertRaises(AviWebSendError): bridge.validate_content('DLA',DLA,[{**TARGET,'std':dt.isoformat()}],NOW)
        for dt in [NOW-timedelta(hours=6), NOW+timedelta(hours=24)]:
            self.assertEqual(bridge.validate_content('DLA',DLA,[{**TARGET,'std':dt.isoformat()}],NOW),DLA+'\r\n')
    def test_only_chg_and_dla(self):
        for op in ['FPL','CNL','CHG ROUTE']:
            with self.assertRaises(AviWebSendError): bridge.validate_content(op,DLA,[TARGET],NOW)
    def test_rejects_outside_content(self):
        with self.assertRaises(AviWebSendError): bridge.validate_content('DLA',DLA+'oops',[TARGET],NOW)
    def test_duplicate_token(self):
        with self.assertRaises(AviWebSendError): bridge.validate_content('CHG',CHG.replace('OPR/','DOF/261125 OPR/'),[TARGET],NOW)
    def test_rows_full_identity(self):
        row=Mock()
        row.find_elements.side_effect=[[Mock(text=t) for t in ['','VJC874','FPL','VVDN','RKSI','25/11/2026','09:00']], [Mock(text=t) for t in ['', 'Callsign', 'ATS MSG', 'DEP', 'DEST', 'Date of Flight', 'Updated']]]
        self.assertEqual(bridge.VerifiedAviWebSender._row_identity(row),('VJC874','VVDN','RKSI','261125'))
    def test_unknown_layout_fails_closed(self):
        row=Mock();row.find_elements.side_effect=[[Mock(text=t) for t in ['VJC874','VVDN','RKSI','25/11/2026']],[]]
        with self.assertRaises(AviWebSendError): bridge.VerifiedAviWebSender._row_identity(row)
    def test_no_click_without_verified_row(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);button=Mock(text='Submit')
        with self.assertRaises(AviWebSendError): sender._safe_click(Mock(),button)
        button.click.assert_not_called()
    def test_submit_native_error_does_not_retry(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);button=Mock(text='Submit');button.click.side_effect=RuntimeError('uncertain')
        driver=Mock()
        driver.find_elements.return_value=[Mock()]
        with patch.object(sender,'_verify_bound'):
            with self.assertRaises(RuntimeError): sender._safe_click(driver,button)
        self.assertEqual(button.click.call_count,1);driver.execute_script.assert_not_called()
    def test_same_row_replaced_invalidates_binding(self):
        sender=bridge.VerifiedAviWebSender([TARGET]); sender.bound=Mock(id='old');sender.current_callsign='VJC874';sender.bound_snapshot=('VJC874','VVDN','RKSI','261125')
        other=Mock(id='new')
        with patch.object(sender,'_candidates',return_value=[other]),patch.object(sender,'_row_identity',return_value=sender.bound_snapshot),patch('aviweb_messages.datetime') as clock:
            clock.fromisoformat.return_value=NOW;clock.now.return_value=NOW
            with self.assertRaises(AviWebSendError): sender._verify_bound(Mock())
    def test_duplicate_row_blocks_submit(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);sender.bound=Mock(id='a');sender.current_callsign='VJC874';sender.bound_snapshot=('VJC874','VVDN','RKSI','261125')
        with patch.object(sender,'_candidates',return_value=[Mock(id='a'),Mock(id='b')]),patch.object(sender,'_row_identity',return_value=sender.bound_snapshot),patch('aviweb_messages.datetime') as clock:
            clock.fromisoformat.return_value=NOW;clock.now.return_value=NOW
            with self.assertRaises(AviWebSendError): sender._verify_bound(Mock())
    def test_rejected_notice_never_counts_sent(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);driver=Mock(current_url=sender.PROCESSED)
        notice=Mock(text='Request rejected');notice.is_displayed.return_value=True
        driver.find_elements.side_effect=[[],[notice]]
        with patch.object(sender,'_verify_bound'),patch.object(AviWebSender,'_addresses_and_submit',return_value='form closed'):
            with self.assertRaises(AviWebSendError): sender._addresses_and_submit(driver)
        self.assertEqual(sender.results,[])
    def test_success_receipt(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);sender.current_callsign='VJC874';driver=Mock(current_url=sender.PROCESSED);driver.find_elements.return_value=[]
        with patch.object(sender,'_verify_bound'),patch.object(AviWebSender,'_addresses_and_submit',return_value='submitted'):
            self.assertEqual(sender._addresses_and_submit(driver),'submitted')
        self.assertEqual(sender.results,[{'callsign':'VJC874','evidence':'submitted'}])
    def test_first_uncertain_message_stops_batch_no_retry(self):
        sender=AviWebSender(headless=True);driver=Mock();emits=[]
        with patch.object(sender,'_driver',return_value=(driver,None)),patch.object(sender,'_login'),patch.object(sender,'_send_dla',side_effect=AviWebSendError('uncertain')) as send:
            result=sender.send('DLA',DLA+'\n'+DLA.replace('874','875'),'test-only','test-only',lambda t,l:emits.append(t),threading.Event())
        self.assertEqual(send.call_count,1);self.assertEqual(result['sent'],0);self.assertEqual(result['total'],2);self.assertEqual(len(result['errors']),1)

if __name__=='__main__':unittest.main()
