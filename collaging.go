package main

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

func multiImagePostServer(urlPath, videoId string, images *[][]byte) error {
	form := new(bytes.Buffer)
	writer := multipart.NewWriter(form)
	for i, image := range *images {
		part, err := writer.CreateFormFile("images", strconv.Itoa(i)+".jpg")
		if err != nil {
			return err
		}
		part.Write(image)
	}

	part, err := writer.CreateFormFile("video_id", videoId)
	if err != nil {
		return err
	}
	part.Write([]byte(videoId))

	writer.Close()

	client := &http.Client{}
	req, err := http.NewRequest("POST", PythonServer+urlPath, form)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyText, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	fmt.Printf("%s\n", bodyText)
	return nil
}

func (t *SimplifiedData) MakeCollage() error {
	return multiImagePostServer("/collage", t.VideoID, &t.ImageBuffers)
}

func (t *SimplifiedData) MakeCollageWithAudio() (string, string, error) {
	videoId := t.VideoID
	audioFileName := "audio-" + videoId + ".mp3"
	err := os.WriteFile(audioFileName, t.SoundBuffer, 0644)
	if err != nil {
		return "", "", err
	}

	out, err := exec.Command("ffmpeg", "-loop", "1", "-framerate", "1", "-i", "collages/collage-"+videoId+".png", "-i", audioFileName, "-map", "0", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-vf", "fps=1,format=yuv420p", "-c:a", "copy", "-shortest", "collages/video-"+videoId+".mp4").
		Output()
	if err != nil {
		fmt.Println(err)
		fmt.Println(string(out))
		return "", "", err
	}

	fmt.Println(string(out))
	os.Remove(audioFileName)

	videoWidth, videoHeight, err := GetVideoDimensions("collages/video-" + videoId + ".mp4")
	if err != nil {
		return "", "", err
	}

	return videoWidth, videoHeight, nil
}

func getAudioLength(inputDir string) (string, error) {
	out, err := exec.Command("ffprobe", "-i", inputDir+"/audio.mp3", "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0").
		Output()
	if err != nil {
		fmt.Println(err)
		fmt.Println(string(out))
		return "0", err
	}
	//print(string(out))
	trimmed := strings.TrimSuffix(string(out), "\n")
	return trimmed, nil
}

func resizeImages(images *[][]byte, videoId string) error {
	err := multiImagePostServer("/resize", videoId, images)
	if err != nil {
		return err
	}
	return nil
}

func (t *SimplifiedData) MakeVideoSlideshow() (string, string, error) {
	videoId := t.VideoID
	err := CreateDirectory("/tmp/collages/" + videoId)
	if err != nil {
		return "", "", err
	}

	err = os.WriteFile("/tmp/collages/"+videoId+"/audio.mp3", t.SoundBuffer, 0644)
	if err != nil {
		return "", "", err
	}

	err = resizeImages(&t.ImageBuffers, videoId)
	if err != nil {
		return "0", "0", err
	}

	var (
		ffmpegTransistions string
		ffmpegVariables    string
		ffmpegInput        string
		timeElapsed        float64
		imageDuration      float64 = 3.5
		offset             float64 = 3.25
	)

	imageInputFiles, err := os.ReadDir("/tmp/collages/" + videoId)
	if err != nil {
		println("Error reading image files")
		return "0", "0", err
	}

	filteredImageFiles := make([]string, 0, len(imageInputFiles)-1)
	for _, file := range imageInputFiles[:len(imageInputFiles)-1] {
		filteredImageFiles = append(
			filteredImageFiles,
			strings.Replace(
				file.Name(),
				"jpg",
				"png",
				1,
			), // images were renamed to png on python server
		)
	}

	audioLength, err := getAudioLength("/tmp/collages/" + videoId)
	if err != nil {
		fmt.Println(err)
		audioLength = strconv.FormatFloat(3.5*float64(len(filteredImageFiles)), 'f', 2, 64)
	}

	sort.Slice(filteredImageFiles, func(i, j int) bool {
		numI, _ := strconv.Atoi(
			strings.TrimSuffix(strings.TrimPrefix(filteredImageFiles[i], "img"), ".png"),
		)
		numJ, _ := strconv.Atoi(
			strings.TrimSuffix(strings.TrimPrefix(filteredImageFiles[j], "img"), ".png"),
		)
		return numI < numJ
	})

	for i := 0; i < len(filteredImageFiles)-1; i++ {
		timeElapsed += imageDuration
		ffmpegInput += fmt.Sprintf(
			"-loop 1 -t %.2f -i /tmp/collages/%s/%s ",
			imageDuration,
			videoId,
			filteredImageFiles[i],
		)
		ffmpegVariables += fmt.Sprintf("[%d]settb=AVTB[img%d];", i, i+1)
	}

	lastImageTime, err := strconv.ParseFloat(audioLength, 64)
	if err != nil {
		fmt.Println(err)
		lastImageTime = 3.5
	} else {
		lastImageTime -= timeElapsed
	}

	ffmpegInput += fmt.Sprintf(
		"-loop 1 -t %.2f -i /tmp/collages/%s/%s ",
		lastImageTime,
		videoId,
		filteredImageFiles[len(filteredImageFiles)-1],
	)
	ffmpegVariables += fmt.Sprintf(
		"[%d]settb=AVTB[img%d];",
		len(filteredImageFiles)-1,
		len(filteredImageFiles),
	)

	ffmpegInput += "-stream_loop -1 -i /tmp/collages/" + videoId + "/audio.mp3" + " -y"

	for i := 1; i <= len(filteredImageFiles); i++ {
		if i == 1 {
			ffmpegTransistions += fmt.Sprintf(
				"[img%d][img%d]xfade=transition=slideleft:duration=0.25:offset=%.2f[filter%d];",
				i,
				i+1,
				offset,
				i,
			)
		} else {
			ffmpegTransistions += fmt.Sprintf("[filter%d][img%d]xfade=transition=slideleft:duration=0.25:offset=%.2f[filter%d];", i-1, i+1, offset, i)
		}
		offset += 3.25
	}

	ffmpegTransistions = strings.TrimRight(ffmpegTransistions, ";")
	ffmpegTransistions = ffmpegTransistions[:strings.LastIndex(ffmpegTransistions[:len(ffmpegTransistions)-1], ";")]

	//inputArgs := strings.Fields(inputStr)
	//var stdBuffer bytes.Buffer
	//mw := io.MultiWriter(os.Stdout, &stdBuffer)

	cmd := exec.Command("ffmpeg", strings.Fields(ffmpegInput)...)
	cmd.Args = append(
		cmd.Args,
		"-filter_complex",
		ffmpegVariables+ffmpegTransistions,
		"-map",
		"[filter"+strconv.Itoa(len(filteredImageFiles)-1)+"]", // the last filter
		"-vcodec",
		"libx264",
		"-map",
		strconv.Itoa(len(filteredImageFiles))+":a", // map the audio
		"-pix_fmt",
		"yuv420p",
		"-t",
		audioLength,
		"collages/slide-"+videoId+".mp4",
	)

	//println(cmd.String())
	//cmd.Stdout = mw
	//cmd.Stderr = mw
	err = cmd.Run()

	if err != nil {
		fmt.Println(err)
		//fmt.Println(stdBuffer.String())
		return "0", "0", err
	}
	videoWidth, videoHeight, err := GetVideoDimensions("collages/slide-" + videoId + ".mp4")
	if err != nil {
		println("Error getting video dimensions")
		return "", "", err
	}
	os.RemoveAll("/tmp/collages/" + videoId)
	return videoWidth, videoHeight, nil
}
