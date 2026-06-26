# Bài thuyết trình dự án Lumi

## 1. Tóm tắt 1 câu

**Lumi là một voice companion tiếng Việt giúp người dùng giao tiếp với AI tự nhiên hơn bằng cách ưu tiên nghe đúng lúc, hiểu đúng ngữ cảnh và phản hồi ngắn, ấm, không làm người dùng có cảm giác đang ra lệnh cho máy.**

## 2. Cách kể chuyện ngắn gọn khi mở đầu

Nếu con người phải học cách nói chuyện với robot, thì robot đó chưa đủ tốt.

Vì vậy, thay vì xây một AI biết làm thật nhiều thứ, nhóm chúng em chọn tập trung vào một câu hỏi khó hơn: làm sao để một người đang ở một mình có thể mở miệng nói chuyện với AI bằng giọng nói, một cách tự nhiên, nhẹ nhàng và không phải lặp lại quá nhiều.

Đó là lý do Lumi ra đời: một người bạn đồng hành bằng giọng nói, nói tiếng Việt, luôn ưu tiên cảm giác hội thoại trước tính năng.

## 3. Bố cục slide đề xuất

1. Vấn đề
2. Ý tưởng giải pháp
3. Trải nghiệm người dùng
4. Kiến trúc MVP
5. Những gì làm cho Lumi tự nhiên hơn
6. Demo
7. Ứng dụng thực tế cho robot
8. Tự đánh giá theo tiêu chí cuộc thi

## 4. Kịch bản thuyết trình 5-7 phút

### Slide 1 - Vấn đề

Xin chào mọi người, nhóm em mang đến dự án **Lumi - ánh sáng đồng hành**.

Trong các hệ thống voice AI hiện nay, vấn đề lớn nhất không phải là AI trả lời được bao nhiêu kiến thức, mà là cảm giác nói chuyện vẫn còn rất "máy". Người dùng phải nói chậm hơn, nói rõ hơn, thậm chí phải học cách ra lệnh.

Nhưng với robot đồng hành, điều đó không đủ tốt. Một robot chỉ thực sự thành công khi người dùng quên mất mình đang nói chuyện với máy.

### Slide 2 - Ý tưởng giải pháp

Từ đó, nhóm em chọn hướng đi rất rõ: **không làm voice assistant kiểu ra lệnh, mà làm voice companion kiểu đối thoại**.

Lumi được thiết kế cho bối cảnh một người ở nhà một mình, cần một thực thể có thể lắng nghe, phản hồi ngắn gọn, không chen ngang, không bắt lặp lại, và tạo cảm giác có người đang hiện diện.

Điểm quan trọng là Lumi không cố "thông minh nhất". Lumi cố "dễ nói chuyện nhất".

### Slide 3 - Trải nghiệm người dùng

Luồng trải nghiệm của Lumi rất đơn giản.

Người dùng chỉ cần mở mic và nói tự nhiên bằng tiếng Việt. Hệ thống ghi nhận lời nói, giữ lại những phần người dùng còn nói dở, chỉ phản hồi khi câu nói đủ trọn ý, rồi trả lời bằng một câu ngắn, ấm và phù hợp để đọc thành tiếng.

Trong demo hiện tại, Lumi đã có một số hành vi giúp hội thoại tự nhiên hơn:

- Không bắt buộc wake word.
- Có cơ chế đệm để chờ người dùng nói xong rồi mới trả lời.
- Có thể ngắt Lumi giữa chừng bằng các ý như "dừng", "im lặng", "ngừng nói".
- Bỏ qua tiếng đệm và nhiễu ngắn như "ừm", "à", hoặc trường hợp micro thu lại chính giọng của Lumi.
- Giữ lịch sử hội thoại để hạn chế bắt người dùng lặp lại ý vừa nói.

### Slide 4 - Kiến trúc MVP

Về kỹ thuật, nhóm em cố tình giữ MVP tập trung vào đường đi quan trọng nhất:

**giọng nói hoặc văn bản -> ASR tiếng Việt -> LLM sinh phản hồi -> TTS tiếng Việt**

Phần backend hiện đã có pipeline xử lý voice và web app để ghi âm trực tiếp từ trình duyệt.

Điểm em muốn nhấn mạnh là nhóm không chỉ nối model với nhau, mà còn tối ưu trải nghiệm hội thoại:

- Nếu hệ thống nhận ra người dùng đã nói trọn ý, thời gian chờ phản hồi được rút xuống rất ngắn.
- Nếu hệ thống thấy người dùng có thể đang nói dở, Lumi sẽ chờ thêm thay vì cắt ngang.
- Khi Lumi bắt đầu trả lời, nội dung có thể được stream theo từng câu để giảm cảm giác chờ xử lý.

### Slide 5 - Điều gì làm Lumi "tự nhiên" hơn

Theo em, có 4 điểm giúp Lumi bám đúng tinh thần cuộc thi.

Thứ nhất, **Lumi ưu tiên turn-taking**. Nghĩa là bài toán không phải chỉ nghe được, mà là biết lúc nào nên trả lời.

Thứ hai, **Lumi ưu tiên lời đáp ngắn và dễ nghe**. Trong prompt và guardrail, nhóm giới hạn phản hồi ngắn, ít câu hỏi, tránh liệt kê dài để TTS nghe giống lời nói thật hơn.

Thứ ba, **Lumi có cơ chế tự bảo vệ trải nghiệm**. Nếu ASR bắt nhầm tiếng đệm, hoặc mic thu lại chính câu nói của Lumi, hệ thống sẽ bỏ qua để giảm việc phản hồi vô nghĩa.

Thứ tư, **Lumi tạo cảm giác hiện diện**, không chỉ bằng nội dung, mà còn bằng giao diện khuôn mặt, trạng thái nghe, nghĩ, nói và khả năng phản hồi liên tục như một nhân vật đồng hành.

### Slide 6 - Demo

Trong phần demo, nhóm em sẽ cho Lumi xử lý một tình huống rất đời thường, ví dụ:

"Lumi ơi, hôm nay mình hơi mệt."

Điều nhóm muốn giám khảo chú ý không phải chỉ là câu trả lời cuối cùng, mà là toàn bộ nhịp hội thoại:

- Người dùng không cần học câu lệnh.
- Lumi không chen ngang khi người dùng còn đang nói.
- Lumi phản hồi ngắn, đúng ngữ cảnh và nghe được bằng giọng nói thật.
- Nếu người dùng đổi ý hoặc muốn ngắt, Lumi có thể dừng.

### Slide 7 - Tính ứng dụng cho robot

Lumi phù hợp với các sản phẩm robot đồng hành trong gia đình, đặc biệt là robot dành cho người sống một mình, người lớn tuổi hoặc các tình huống cần tương tác giọng nói nhẹ nhàng, tự nhiên.

Điều thực tế ở đây là hệ thống không phụ thuộc vào một ý tưởng quá xa vời. Nó đi thẳng vào một bài toán mà robot thương mại nào cũng gặp: làm sao để người dùng nói chuyện thoải mái hơn, ít phải sửa câu hơn, và có cảm giác robot đang hiểu nhịp đối thoại của mình.

### Slide 8 - Kết luận

Tóm lại, Lumi không cố gắng trở thành AI nói nhiều nhất, mà là AI biết lắng nghe đúng lúc nhất.

Nếu cuộc thi này đặt trọng tâm vào **nghe, hiểu và phản hồi tự nhiên**, thì Lumi là một câu trả lời rất trực diện: chúng em chọn tối ưu cảm giác giao tiếp trước, rồi mới mở rộng thêm tính năng sau.

Xin cảm ơn mọi người.

## 5. Kịch bản demo 1 phút

Bạn có thể demo theo đúng thứ tự này:

1. Mở giao diện Lumi, cho thấy trạng thái đang nghe.
2. Nói: "Lumi ơi, hôm nay mình hơi mệt."
3. Ngưng một nhịp ngắn để Lumi phản hồi.
4. Nói tiếp: "Chắc tại mình làm việc nhiều quá."
5. Cho thấy Lumi không cắt ngang ở giữa, mà gom ý rồi trả lời.
6. Khi Lumi đang nói, thử nói: "Dừng lại."
7. Nhấn mạnh rằng Lumi có thể bị ngắt giữa chừng, giống hội thoại thật hơn.

Nếu muốn an toàn hơn khi demo, dùng 2 kịch bản:

- Kịch bản cảm xúc: "Hôm nay mình hơi mệt."
- Kịch bản đời thường: "Tối nay ăn gì nhẹ bụng nhỉ?"

## 6. Những điểm nên nói thật với giám khảo

Đây là phần rất quan trọng để tránh bị hỏi xoáy.

- MVP hiện mạnh nhất ở trải nghiệm turn-taking, buffer lời nói, interrupt, và phản hồi ngắn cho voice.
- Hệ thống đã có khung cho addressee detection, speaker verification và emotion-aware conversation, nhưng không phải tất cả module đều đang hoạt động đầy đủ trong đường chạy MVP.
- Speaker verification trong flow voice hiện đang được tắt để ưu tiên tốc độ phản hồi.
- Vì vậy, điểm mạnh thật sự của bản demo hiện tại là **nhịp hội thoại tự nhiên**, không phải khoe quá nhiều "AI feature".

Nói như vậy sẽ làm phần trình bày đáng tin hơn.

## 7. Tự đánh giá theo tiêu chí cuộc thi

Lưu ý: 4 tiêu chí bạn gửi cộng lại thành **70 điểm**. Bên dưới là điểm chấm theo đúng thang đó, đồng thời có quy đổi tương đối sang 100 để dễ hình dung.

### Tự nhiên - 24/30

Điểm mạnh:

- Không ép người dùng dùng câu lệnh cứng.
- Có buffer để chờ người dùng nói xong.
- Phản hồi được thiết kế ngắn, mềm và phù hợp TTS.
- Có cơ chế tránh phản hồi vào tiếng đệm hoặc tiếng vọng của chính robot.

Điểm trừ:

- Một số câu trả lời vẫn có thể hơi "AI", đặc biệt khi model suy diễn sai ngữ cảnh.
- Độ tự nhiên vẫn phụ thuộc chất lượng ASR và TTS ở từng máy chạy demo.

### Mượt mà - 16/20

Điểm mạnh:

- Có flush nhanh khi hệ thống nhận ra lượt nói đã hoàn chỉnh.
- Có interrupt để dừng phản hồi đang phát.
- Có cơ chế gom nhiều mảnh lời nói thành một lượt trả lời.

Điểm trừ:

- Khi ASR trình duyệt nhận chưa tốt và phải fallback sang backend, trải nghiệm có thể chậm hơn.
- Với môi trường ồn hoặc mic không ổn định, vẫn có nguy cơ hụt nhịp hội thoại.

### Thiết thực - 13/15

Điểm mạnh:

- Rất phù hợp cho robot đồng hành trong nhà.
- Tập trung đúng bài toán sản phẩm: nghe, hiểu, đáp lại bằng giọng nói.
- Kiến trúc hiện tại có thể gắn vào robot có mic, loa và màn hình biểu cảm.

Điểm trừ:

- Để đi vào sản phẩm thật, vẫn cần tăng độ ổn định dài hạn cho ASR, latency và hồ sơ người dùng.

### Sáng tạo - 4/5

Điểm mạnh:

- Chọn trải nghiệm "companion" thay vì "command assistant" là hướng đi đúng và có cá tính.
- Giao diện khuôn mặt và trạng thái nghe/nói giúp tăng cảm giác hiện diện.

Điểm trừ:

- Ý tưởng voice companion không hoàn toàn mới, nên điểm sáng tạo nằm nhiều ở cách triển khai trải nghiệm hơn là ở concept thuần túy.

### Tổng điểm đề xuất

- Tổng theo thang cuộc thi bạn gửi: **57/70**
- Quy đổi tương đối: **khoảng 81/100**

Đây là mức điểm tốt và có tính cạnh tranh, đặc biệt nếu demo chạy mượt.

## 8. Nhận định ngắn gọn để nói trước phần chấm điểm

Nếu phải tự đánh giá ngắn trong 20 giây, bạn có thể nói:

> Nhóm em tin Lumi mạnh nhất ở hai yếu tố: tự nhiên và mượt mà. Bọn em không cố nhồi nhiều tính năng, mà tập trung làm cho người dùng nói chuyện với AI bằng giọng nói dễ hơn, ít bị ngắt mạch hơn và có cảm giác đang được lắng nghe thật sự.

## 9. 3 câu giám khảo hỏi là trả lời được ngay

### Nếu giám khảo hỏi: "Điểm khác biệt lớn nhất của các bạn là gì?"

Khác biệt lớn nhất là bọn em không thiết kế Lumi như một trợ lý ra lệnh, mà như một người bạn đồng hành. Vì vậy phần khó nhất nhóm tập trung giải không phải tri thức, mà là nhịp hội thoại: khi nào nên nghe tiếp, khi nào nên trả lời, và làm sao để câu trả lời nghe tự nhiên.

### Nếu giám khảo hỏi: "Tại sao không làm thêm nhiều tính năng hơn?"

Vì đề bài nhấn mạnh trải nghiệm nghe, hiểu và phản hồi. Trong 1 tuần, bọn em chọn làm ít hơn nhưng đúng trọng tâm hơn. Nếu hội thoại chưa tự nhiên thì thêm nhiều tính năng cũng không cứu được trải nghiệm.

### Nếu giám khảo hỏi: "Tại sao giải pháp này phù hợp với robot của công ty?"

Vì bất kỳ robot đồng hành nào cũng cần một lớp giao tiếp giọng nói tự nhiên. Lumi giải đúng lớp đó: nghe người dùng theo nhịp tự nhiên, trả lời ngắn gọn bằng giọng nói, và tạo cảm giác hiện diện chứ không chỉ thực hiện lệnh.

## 10. Gợi ý nói rất ngắn nếu chỉ còn 2 phút

Lumi là một voice companion tiếng Việt cho người sống một mình. Thay vì làm một AI biết thật nhiều thứ, nhóm em tập trung giải bài toán khó hơn: làm cho việc nói chuyện với AI tự nhiên như nói với một người trong nhà. MVP hiện tại đã có ghi âm từ trình duyệt, nhận diện lời nói, buffer để chờ người dùng nói xong, phản hồi ngắn bằng giọng nói, và hỗ trợ ngắt giữa chừng. Theo tiêu chí cuộc thi, nhóm em tự tin nhất ở độ tự nhiên, độ mượt và tính ứng dụng trực tiếp cho robot đồng hành.
