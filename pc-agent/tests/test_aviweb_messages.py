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

class OperatorSubmitAndVaadin(unittest.TestCase):
    WANT=('VJC874','VVDN','RKSI','261125')
    @staticmethod
    def el(text):
        e=Mock(text='');e.get_attribute.return_value=text;return e
    def row(self,cells,headers):
        r=Mock();r.find_elements.side_effect=lambda by,xp:[self.el(t) for t in (cells if xp=='./td' else headers)];return r
    def test_vaadin_header_cells_are_read(self):
        r=self.row(['','VJC874','FPL','VVDN','RKSI','25/11/2026','25/11/2026 08:10'],['#','Callsign','ATS Msg','Dep','Dest','Date of Flight','Update Time'])
        self.assertEqual(bridge.VerifiedAviWebSender._row_identity(r),self.WANT)
    def test_content_fallback_only_exact_row(self):
        sender=bridge.VerifiedAviWebSender([TARGET])
        good=self.row(['VJC874','FPL','VVDN','RKSI','2026-11-25','2026-11-25 08:10'],[])
        self.assertTrue(sender._row_matches(good,self.WANT))
        for cells in (['VJC874','RKSI','VVDN','2026-11-25'],['VJC874','VVDN','RKSI','2026-11-24'],['VJC874','VVDN','RKSI','FILED','2026-11-25'],['VJC874','2026-11-25','VVDN','RKSI','2026-11-25'],['VJC875','VVDN','RKSI','2026-11-25']):
            with self.subTest(cells=cells): self.assertFalse(sender._row_matches(self.row(cells,[]),self.WANT))
    # Real AviWeb Processed layout (26 Nov 2026 screenshot).
    REAL_H=['Aircraft ID','ATS Message','Departure','Destination','Date of Flight','Creation / Update Time','Status']
    WANT334=('VJC334','VVPQ','VVTS','261126')
    def real(self,day,headers=None,first='1'):
        return self.row([first,'+VJC334','CFL','VVPQ (Kien giang)','VVTS (Ho chi minh)',f'2026-11-{day} 15:10','2026-11-26 06:41','Filed'],self.REAL_H if headers is None else headers)
    def test_real_aviweb_headers_identify_row(self):
        self.assertEqual(bridge.VerifiedAviWebSender._row_identity(self.real('26')),self.WANT334)
        self.assertEqual(bridge.VerifiedAviWebSender._row_identity(self.real('26',['']+self.REAL_H)),self.WANT334)
    def test_real_aviweb_only_todays_row_matches(self):
        for headers in (None,[]):
            sender=bridge.VerifiedAviWebSender([TARGET])
            hits=[d for d in ('26','25','24','23') if sender._row_matches(self.real(d,headers),self.WANT334)]
            with self.subTest(headers=headers): self.assertEqual(hits,['26'])
    def test_creation_date_never_stands_in_for_dof(self):
        sender=bridge.VerifiedAviWebSender([TARGET])
        r=self.row(['1','+VJC334','CFL','VVPQ (Kien giang)','VVTS (Ho chi minh)','2026-11-25 12:50','2026-11-26 06:41','Closed'],[])
        self.assertFalse(sender._row_matches(r,self.WANT334))
    def test_aerodrome_cell_needs_plain_icao(self):
        self.assertEqual(bridge._row_icao('VVPQ (Kien giang)'),'VVPQ')
        for bad in ('VVPQ VVTS','VVPQX','(VVPQ)','VVP'): self.assertEqual(bridge._row_icao(bad),'')
    def manual(self):
        sender=bridge.VerifiedAviWebSender([TARGET],manual_submit=True);sender._final_stage=True;sender.current_callsign='VJC874'
        driver=Mock(current_url=sender.PROCESSED);driver.find_elements.return_value=[Mock()]
        return sender,driver
    def test_operator_mode_never_clicks_and_counts_operator_submit(self):
        sender,driver=self.manual();button=Mock(text='Submit')
        class StaleElementReferenceException(Exception): pass
        button.is_enabled.side_effect=StaleElementReferenceException()
        driver.execute_script.side_effect=[None,1]
        with patch.object(sender,'_verify_bound'):
            self.assertEqual(sender._safe_click(driver,button),'operator Submit')
        button.click.assert_not_called()
    def test_operator_closing_form_without_submit_is_not_sent(self):
        sender,driver=self.manual();button=Mock(text='Submit')
        class StaleElementReferenceException(Exception): pass
        button.is_enabled.side_effect=StaleElementReferenceException()
        driver.execute_script.side_effect=[None,0]
        with patch.object(sender,'_verify_bound'):
            with self.assertRaises(AviWebSendError): sender._safe_click(driver,button)
        button.click.assert_not_called()
    def test_operator_timeout_is_not_sent(self):
        sender,driver=self.manual();button=Mock(text='Submit');driver.execute_script.return_value=0
        with patch.object(sender,'_verify_bound'),patch.object(bridge,'MANUAL_SUBMIT_WAIT_S',0):
            with self.assertRaises(AviWebSendError): sender._safe_click(driver,button)
        button.click.assert_not_called()
    def test_delay_step_waits_for_operator_then_resumes_on_click(self):
        sender,driver=self.manual();sender._final_stage=False;button=Mock(text='Submit')
        driver.execute_script.side_effect=[None,0,0,1]
        with patch.object(sender,'_verify_bound'),patch.object(bridge.time,'sleep'):
            self.assertEqual(sender._safe_click(driver,button),'operator Submit')
        button.click.assert_not_called();self.assertEqual(driver.execute_script.call_count,4)
    def test_delay_step_closed_without_operator_click_is_not_sent(self):
        sender,driver=self.manual();sender._final_stage=False;button=Mock(text='Submit')
        class StaleElementReferenceException(Exception): pass
        button.is_enabled.side_effect=StaleElementReferenceException();driver.execute_script.side_effect=[None,0]
        with patch.object(sender,'_verify_bound'):
            with self.assertRaises(AviWebSendError): sender._safe_click(driver,button)
        button.click.assert_not_called()
    def dla(self,manual,value='15:10',cls='v-textfield'):
        sender=bridge.VerifiedAviWebSender([TARGET],manual_submit=manual);driver=Mock()
        field=Mock();field.get_attribute.side_effect=lambda k:{'value':value,'class':cls}[k]
        wait=Mock();wait.return_value.until.return_value=field
        sel=(None,None,None,Mock(),Mock(TAB='TAB'),Mock(),wait)
        typed=[]
        with patch.object(sender,'_selenium',return_value=sel),patch.object(sender,'_open_row_action'),patch.object(sender,'_type_input',side_effect=lambda d,e,v,c=None:typed.append((v,c))),\
             patch.object(sender,'_safe_click') as click,patch.object(sender,'_addresses_and_submit',return_value='ok') as final,patch.object(bridge.time,'sleep'):
            try: out=sender._send_dla(driver,'(DLA-VJC334-VVPQ1510-VVTS-DOF/261126)')
            except AviWebSendError as e: out=e
        return out,typed,click,final
    def test_delay_time_is_typed_with_colon(self):
        out,typed,click,final=self.dla(False)
        self.assertEqual(typed,[('15:10','TAB')]);self.assertEqual(out,'ok');final.assert_called_once()
        self.assertEqual(bridge.delay_clock('0005'),'00:05')
        for bad in ('2460','1560','151','15:10'):
            with self.assertRaises(AviWebSendError): bridge.delay_clock(bad)
    def test_delay_time_rejected_or_different_never_submits(self):
        for kw in ({'value':'15:01'},{'value':''},{'cls':'v-textfield v-textfield-error'}):
            out,typed,click,final=self.dla(False,**kw)
            with self.subTest(kw=kw):
                self.assertIsInstance(out,AviWebSendError);click.assert_not_called();final.assert_not_called()
    def test_delay_red_field_in_operator_mode_is_handed_to_operator(self):
        out,typed,click,final=self.dla(True,cls='v-textfield v-textfield-error')
        self.assertEqual(out,'ok');self.assertGreaterEqual(click.call_count,1)
    def test_auto_mode_still_clicks_once(self):
        sender=bridge.VerifiedAviWebSender([TARGET]);sender._final_stage=True;button=Mock(text='Submit');driver=Mock();driver.find_elements.return_value=[Mock()]
        with patch.object(sender,'_verify_bound'): sender._safe_click(driver,button)
        self.assertEqual(button.click.call_count,1)
    def test_manual_payload_forces_visible_chrome(self):
        seen=[]
        def fake(self,*a): seen.append((self.manual_submit,self.headless)); return {'sent':0}
        payload={'operation':'DLA','content':DLA,'expected':[{**TARGET,'std':datetime.now(timezone.utc).isoformat()}],'aviweb_user':'t','aviweb_pass':'t','headless':True}
        with patch.object(bridge.VerifiedAviWebSender,'send',fake):
            bridge.send_messages({**payload,'manual_submit':True},lambda *a:None,threading.Event())
            bridge.send_messages(payload,lambda *a:None,threading.Event())
        self.assertEqual(seen,[(True,False),(False,True)])

if __name__=='__main__':unittest.main()
